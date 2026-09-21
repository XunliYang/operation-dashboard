"""GitHub 增量采集编排：拉取事件流 → 归一化 → 写入事实表 → 记 collect_run。

Webhook 是实时主通道（见 github/webhook.py），本模块是 APScheduler 定时兜底：
优先批量拉取（REST `since` 增量 + ETag/If-None-Match，304 不计配额），
REST 列表接口对 commit/issue 用 `since` 游标增量，PR/workflow-run 用
`ON CONFLICT` 幂等 upsert 兜底。GraphQL 批量为后续优化（客户端已就绪）。
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from loguru import logger
from psycopg import Connection

import collector.db as db
from collector.github.client import GitHubClient

# GraphQL 仓库快照查询（Phase 1 主路径仍走 REST；GraphQL 批量拉取为后续优化）
REPO_OVERVIEW_QUERY = """
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    databaseId
    defaultBranchRef { name }
    isArchived
    stargazerCount
    forkCount
  }
}
"""


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _user(obj: dict | None) -> tuple[str | None, int | None]:
    if not obj:
        return None, None
    return obj.get("login"), obj.get("id")


class GitHubCollector:
    def __init__(
        self, client: GitHubClient, conn: Connection, *, backfill_days: int = 90
    ) -> None:
        self.client = client
        self.conn = conn
        self.backfill_days = backfill_days
        self._review_cutoff = _utcnow() - timedelta(days=backfill_days)

    # ---- 各资源摄入 ----

    def _ingest_commit(self, repo_id: int, c: dict) -> None:
        sha = c["sha"]
        commit = c.get("commit") or {}
        author = commit.get("author") or {}
        committer = commit.get("committer") or {}
        committed_at = (
            db.parse_dt(author.get("date"))
            or db.parse_dt(committer.get("date"))
            or _utcnow()
        )
        login, gh_id = _user(c.get("author"))
        author_id = db.upsert_contributor(
            self.conn,
            gh_login=login,
            gh_id=gh_id,
            display_name=author.get("name") or login,
            seen_at=committed_at,
        )
        is_merge = len(c.get("parents") or []) > 1
        db.upsert_commit(
            self.conn,
            repo_id=repo_id,
            sha=sha,
            author_id=author_id,
            committed_at=committed_at,
            branch=None,
            additions=None,
            deletions=None,
            files_changed=None,
            is_merge=is_merge,
        )

    def _ingest_pull_request(self, repo_id: int, owner: str, name: str, pr: dict) -> None:
        number = pr["number"]
        created_at = db.parse_dt(pr.get("created_at")) or _utcnow()
        login, gh_id = _user(pr.get("user"))
        author_id = db.upsert_contributor(
            self.conn, gh_login=login, gh_id=gh_id, display_name=login, seen_at=created_at
        )

        review_count = 0
        first_review_at: datetime | None = None
        updated_at = db.parse_dt(pr.get("updated_at"))
        if updated_at is None or updated_at >= self._review_cutoff:
            reviews = self.client.get_json(f"/repos/{owner}/{name}/pulls/{number}/reviews")
            review_count = len(reviews)
            for r in reviews:
                submitted_at = db.parse_dt(r.get("submitted_at")) or _utcnow()
                r_login, r_gh = _user(r.get("user"))
                reviewer_id = db.upsert_contributor(
                    self.conn, gh_login=r_login, gh_id=r_gh, display_name=r_login, seen_at=submitted_at
                )
                db.upsert_review(
                    self.conn,
                    repo_id=repo_id,
                    pr_number=number,
                    reviewer_id=reviewer_id,
                    submitted_at=submitted_at,
                    state=r.get("state"),
                )
            submitted = [db.parse_dt(r.get("submitted_at")) for r in reviews if r.get("submitted_at")]
            submitted = [t for t in submitted if t is not None]
            if submitted:
                first_review_at = min(submitted)

        db.upsert_pull_request(
            self.conn,
            repo_id=repo_id,
            pr_number=number,
            author_id=author_id,
            state=pr.get("state", "open"),
            title=pr.get("title"),
            created_at=created_at,
            first_review_at=first_review_at,
            merged_at=db.parse_dt(pr.get("merged_at")),
            closed_at=db.parse_dt(pr.get("closed_at")),
            review_count=review_count,
            additions=pr.get("additions"),
            deletions=pr.get("deletions"),
        )

    def _ingest_issue(self, repo_id: int, issue: dict) -> None:
        created_at = db.parse_dt(issue.get("created_at")) or _utcnow()
        login, gh_id = _user(issue.get("user"))
        author_id = db.upsert_contributor(
            self.conn, gh_login=login, gh_id=gh_id, display_name=login, seen_at=created_at
        )
        is_pr = issue.get("pull_request") is not None
        labels = [label.get("name") for label in (issue.get("labels") or []) if label.get("name")]
        db.upsert_issue(
            self.conn,
            repo_id=repo_id,
            issue_number=issue["number"],
            author_id=author_id,
            state=issue.get("state", "open"),
            title=issue.get("title"),
            is_pull_request=is_pr,
            created_at=created_at,
            closed_at=db.parse_dt(issue.get("closed_at")),
            labels=labels,
        )

    def _ingest_workflow_run(self, repo_id: int, run: dict) -> None:
        started = db.parse_dt(run.get("run_started_at") or run.get("created_at")) or _utcnow()
        completed = db.parse_dt(run.get("updated_at"))
        duration_s = int((completed - started).total_seconds()) if completed else None
        db.upsert_workflow_run(
            self.conn,
            repo_id=repo_id,
            run_id=run["id"],
            workflow_name=run.get("name"),
            conclusion=run.get("conclusion"),
            status=run.get("status"),
            started_at=started,
            completed_at=completed,
            duration_s=duration_s,
        )

    # ---- 主流程 ----

    def _commits_cursor(self, repo_id: int) -> datetime:
        row = self.conn.execute(
            "SELECT MAX(committed_at) FROM fact_commit WHERE repo_id = %s", (repo_id,)
        ).fetchone()
        if row and row[0]:
            return row[0]
        return _utcnow() - timedelta(days=self.backfill_days)

    def collect_repo(self, owner: str, name: str) -> dict:
        """增量采集单个仓库，返回统计与配额余量。失败抛异常，由调用方记 collect_run。"""
        meta = self.client.get_json(f"/repos/{owner}/{name}")
        repo_id = db.upsert_repo(
            self.conn,
            gh_id=meta["id"],
            owner=owner,
            name=name,
            default_branch=meta.get("default_branch", "main"),
            archived=bool(meta.get("archived", False)),
        )

        since = self._commits_cursor(repo_id)
        since_iso = since.isoformat()

        commits = self.client.paged(
            f"/repos/{owner}/{name}/commits", {"since": since_iso, "per_page": 100}
        )
        for c in commits:
            self._ingest_commit(repo_id, c)
        logger.info("repo {}/{}: {} commits since {}", owner, name, len(commits), since_iso)

        pulls = self.client.paged(
            f"/repos/{owner}/{name}/pulls",
            {"state": "all", "sort": "updated", "direction": "desc", "per_page": 100},
        )
        open_prs = 0
        for p in pulls:
            if p.get("state") == "open":
                open_prs += 1
            self._ingest_pull_request(repo_id, owner, name, p)
        logger.info("repo {}/{}: {} pulls", owner, name, len(pulls))

        issues = self.client.paged(
            f"/repos/{owner}/{name}/issues", {"state": "all", "per_page": 100, "since": since_iso}
        )
        for i in issues:
            self._ingest_issue(repo_id, i)
        logger.info("repo {}/{}: {} issues", owner, name, len(issues))

        runs = self.client.paged(
            f"/repos/{owner}/{name}/actions/runs", {"per_page": 100}, items_key="workflow_runs"
        )
        for r in runs:
            self._ingest_workflow_run(repo_id, r)
        logger.info("repo {}/{}: {} workflow runs", owner, name, len(runs))

        db.upsert_repo_metric_daily(
            self.conn,
            repo_id=repo_id,
            date=date.today(),
            stars=meta.get("stargazers_count", 0),
            forks=meta.get("forks_count", 0),
            watchers=meta.get("subscribers_count", 0),
            open_issues=meta.get("open_issues_count", 0),
            open_prs=open_prs,
        )

        remaining = self.client.rate_limit.remaining if self.client.rate_limit else None
        return {
            "repo_id": repo_id,
            "rate_limit_remaining": remaining,
            "commits": len(commits),
            "pulls": len(pulls),
            "issues": len(issues),
            "runs": len(runs),
        }