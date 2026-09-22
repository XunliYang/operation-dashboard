"""wiki：仓库不存在不抛异常记 0，email → hash_email 匹配作者，NUL 分列解析。"""

from __future__ import annotations

from app.services.org_classifier import hash_email

import collector.wiki as wiki


class _Proc:
    def __init__(self, returncode: int = 0, stdout: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout


class _Conn:
    def __init__(self, author_id=None) -> None:
        self._author_id = author_id

    def execute(self, sql: str, params=None):
        return self

    def fetchone(self):
        return (self._author_id,) if self._author_id is not None else None


def test_parse_log_splits_nul_separated_fields():
    text = "abc123\x00alice@huawei.com\x001704067200\x00first revision\nHome.md\n\n"
    revs = wiki._parse_log(text)
    assert len(revs) == 1
    assert revs[0]["sha"] == "abc123"
    assert revs[0]["email"] == "alice@huawei.com"
    assert revs[0]["ts"] == "1704067200"
    assert revs[0]["pages"] == ["Home.md"]


def test_parse_log_handles_multiple_commits_and_pages():
    text = (
        "sha1\x00a@x.com\x001\x00one\nHome.md\nSidebar.md\n\n"
        "sha2\x00b@y.com\x002\x00two\nFAQ.md\n"
    )
    revs = wiki._parse_log(text)
    assert [r["sha"] for r in revs] == ["sha1", "sha2"]
    assert revs[0]["pages"] == ["Home.md", "Sidebar.md"]
    assert revs[1]["pages"] == ["FAQ.md"]


def test_page_slug_strips_markdown_extension():
    assert wiki._page_slug("Home.md") == "Home"
    assert wiki._page_slug("Foo-Bar.wiki") == "Foo-Bar"
    assert wiki._page_slug("NoExt") == "NoExt"


def test_collect_wiki_absent_repo_returns_zero(monkeypatch):
    """仓库不存在 / 无 wiki 是正常路径：0 条修订、不抛异常、不写库。"""
    monkeypatch.setattr(wiki, "_git", lambda args, *, timeout, cwd=None: _Proc(returncode=128))
    writes: list[dict] = []
    monkeypatch.setattr(wiki.db, "upsert_wiki_revision", lambda conn, **k: writes.append(k))

    assert wiki.collect_wiki(_Conn(), repo_id=1, owner="o", name="n", salt="s") == 0
    assert writes == []


def test_collect_wiki_matches_author_by_email_hash(monkeypatch):
    clone = _Proc(returncode=0)
    log = _Proc(returncode=0, stdout="abc\x00alice@huawei.com\x001704067200\x00rev\nHome.md\n")

    calls = {"clone": 0}

    def fake_git(args, *, timeout, cwd=None):
        calls["clone"] += 1
        return clone if args[0] == "clone" else log

    monkeypatch.setattr(wiki, "_git", fake_git)
    writes: list[dict] = []
    monkeypatch.setattr(wiki.db, "upsert_wiki_revision", lambda conn, **k: writes.append(k))

    n = wiki.collect_wiki(_Conn(author_id=99), repo_id=1, owner="o", name="n", salt="s")
    assert n == 1
    assert writes[0]["author_id"] == 99
    assert writes[0]["author_email_hash"] == hash_email("alice@huawei.com", "s")
    assert writes[0]["page_slug"] == "Home"
    assert writes[0]["revision_sha"] == "abc"


def test_collect_wiki_unmatched_email_author_id_null(monkeypatch):
    log = _Proc(returncode=0, stdout="abc\x00ghost@unknown.org\x001704067200\x00rev\nHome.md\n")

    def fake_git(args, *, timeout, cwd=None):
        return _Proc(returncode=0) if args[0] == "clone" else log

    monkeypatch.setattr(wiki, "_git", fake_git)
    writes: list[dict] = []
    monkeypatch.setattr(wiki.db, "upsert_wiki_revision", lambda conn, **k: writes.append(k))

    # _Conn() 无作者匹配 → author_id = NULL，但仍计入 wiki 总量
    n = wiki.collect_wiki(_Conn(author_id=None), repo_id=1, owner="o", name="n", salt="s")
    assert n == 1
    assert writes[0]["author_id"] is None
