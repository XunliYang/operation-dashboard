"""管理路由：`POST /admin/collect` 落库 queued 记录，`GET /admin/collect-runs` 可读回。

端点只负责把「手动触发」写入 `collect_run(status=queued)` 并返回 run_id；
真正的采集由 collector 的增量 job 消费 queued 记录后执行（见 collector/tests/test_jobs.py）。
本测试用假连接验证路由的写入与返回语义，不依赖真实 Postgres。
"""

from __future__ import annotations

from app.routers.deps import db_conn


class _Row:
    def __init__(self, *vals):
        self._vals = tuple(vals)

    def __getitem__(self, i):
        return self._vals[i]


class _FakeConn:
    def __init__(self):
        self.executed: list[tuple[str, tuple | None]] = []
        self.rows: list[tuple] = []
        self.committed = False

    def execute(self, sql: str, params=None):
        self.executed.append((sql, params))
        return self

    def fetchone(self):
        return _Row(1)  # 模拟 RETURNING run_id = 1

    def fetchall(self):
        return [_Row(*r) for r in self.rows]

    def commit(self):
        self.committed = True


def _install(fake: _FakeConn, app):
    def override():
        yield fake

    app.dependency_overrides[db_conn] = override


def test_post_collect_writes_queued_run_and_returns_run_id(client, app):
    fake = _FakeConn()
    _install(fake, app)

    resp = client.post("/admin/collect", json={"repo": None, "full_backfill": False})

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["run_id"] == 1
    assert body["data"]["status"] == "queued"
    assert body["data"]["job"] == "github_incremental"

    # 落库的是 status=queued 的 collect_run
    sql, params = fake.executed[0]
    assert "INSERT INTO collect_run" in sql
    assert "queued" in sql
    assert params == ("github_incremental", None)
    assert fake.committed is True


def test_post_collect_full_backfill_uses_backfill_job(client, app):
    fake = _FakeConn()
    _install(fake, app)

    resp = client.post("/admin/collect", json={"repo": None, "full_backfill": True})

    assert resp.json()["data"]["job"] == "github_backfill"
    assert fake.executed[0][1] == ("github_backfill", None)


def test_get_collect_runs_returns_rows(client, app):
    fake = _FakeConn()
    fake.rows = [(1, "github_incremental", None, None, "queued", None, None, None, None)]
    _install(fake, app)

    resp = client.get("/admin/collect-runs")

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) == 1
    assert data[0]["run_id"] == 1
    assert data[0]["status"] == "queued"