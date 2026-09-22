"""wiki 采集：`git clone --bare <repo>.wiki.git` → `git log` → `fact_wiki_revision`。

关键实测事实：OpenAN 14 仓的 wiki 仓库全部不存在（`git ls-remote` 返回
`Repository not found`），但其中 9 仓 `has_wiki=true`。所以「仓库不存在 / 无 wiki」
是**正常路径**：必须记 0 条修订且不抛异常、不写 failed collect_run。

归属口径（后续聚合统一引用本 docstring 的结论）：
    wiki commit 没有 GitHub 用户身份，用 author email → `hash_email(salt, email)`
    匹配 `dim_contributor.email_hash`；匹配不到则 `author_id = NULL`。该修订计入
    wiki 总量，不计入任何个人排名。

`git clone` 设超时 + 失败兜底，一个 wiki 仓卡住不会拖死整轮采集。
"""

from __future__ import annotations

import subprocess
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from app.services.org_classifier import hash_email
from loguru import logger

import collector.db as db

_CLONE_TIMEOUT = 120
_LOG_TIMEOUT = 60

# %x00 是 git 机器可读输出的空字节分隔符（git 会解析成 NUL，而非 Python 里真正
# 的 \x00 字符）。用 NUL 分列是因为邮箱无定长、紧跟其后解析 epoch/主题会歧义。
_LOG_FORMAT = "%H%x00%ae%x00%at%x00%s"


def _git(args: list[str], *, timeout: int, cwd: str | None = None) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=timeout, cwd=cwd
        )
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        logger.warning("git {} failed: {}", args[0], exc)
        return None


def _page_slug(path: str) -> str:
    """wiki 页面文件路径 → slug（去掉扩展名）。"""
    name = Path(path).name
    for ext in (".wiki", ".markdown", ".md"):
        if name.lower().endswith(ext):
            return name[: -len(ext)]
    return name


def _parse_log(text: str) -> list[dict]:
    """解析 `git log --pretty=format:<NUL 分列> --name-only` 输出。

    每条 commit 行格式：`<sha>\x00<email>\x00<epoch>\x00<subject>`，其后跟该 commit
    改动的页面文件（每行一个），空行分隔下一条 commit。
    """
    revisions: list[dict] = []
    current: dict | None = None
    for line in text.split("\n"):
        if "\x00" in line:
            sha, email, ts, subject = line.split("\x00", 3)
            current = {"sha": sha, "email": email, "ts": ts, "subject": subject, "pages": []}
            revisions.append(current)
        elif current is not None and line.strip():
            current["pages"].append(line.strip())
    return revisions


def collect_wiki(conn, *, repo_id: int, owner: str, name: str, salt: str) -> int:
    """采集 wiki 修订历史，返回写入的修订条数（含 page 展开）。

    仓库不存在 / 无 wiki / 空 wiki 均返回 0 且不抛异常（正常路径）。
    """
    url = f"https://github.com/{owner}/{name}.wiki.git"
    with tempfile.TemporaryDirectory(prefix="od-wiki-") as tmp:
        clone = _git(["clone", "--bare", url, tmp], timeout=_CLONE_TIMEOUT)
        if clone is None or clone.returncode != 0:
            logger.info("wiki absent for {}/{}: 0 revisions", owner, name)
            return 0

        log = _git(
            ["log", f"--pretty=format:{_LOG_FORMAT}", "--name-only"],
            timeout=_LOG_TIMEOUT,
            cwd=tmp,
        )
        if log is None or log.returncode != 0 or not log.stdout.strip():
            return 0

        count = 0
        for rev in _parse_log(log.stdout):
            email = rev["email"]
            email_hash = hash_email(email, salt) if email else None
            author_id = None
            if email_hash:
                row = conn.execute(
                    "SELECT contributor_id FROM dim_contributor WHERE email_hash = %s LIMIT 1",
                    (email_hash,),
                ).fetchone()
                if row is not None:
                    author_id = row[0]
            committed_at = datetime.fromtimestamp(int(rev["ts"]), tz=UTC)
            for page in rev["pages"] or ["Home"]:
                db.upsert_wiki_revision(
                    conn,
                    repo_id=repo_id,
                    page_slug=_page_slug(page),
                    revision_sha=rev["sha"],
                    author_id=author_id,
                    author_email_hash=email_hash,
                    committed_at=committed_at,
                    message=rev["subject"] or None,
                )
                count += 1
        return count