"""配置自洽：OpenAN 为默认组织，且 org_mapping 与 tracked_repos 清单一致。"""

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"


def test_openan_default_org_and_repo_list_consistent():
    tracked = yaml.safe_load((CONFIG_DIR / "tracked_repos.yaml").read_text(encoding="utf-8"))
    mapping = yaml.safe_load((CONFIG_DIR / "org_mapping.yaml").read_text(encoding="utf-8"))

    enabled = {r["repo"] for r in tracked["repos"] if r.get("enabled", True)}
    openan_repos = set(mapping["orgs"]["openan"]["repos"])

    assert mapping["default_org"] == "openan"
    assert enabled == openan_repos
    assert len(enabled) == 13
    assert all(name.startswith("project-openan/") for name in enabled)
    assert "project-openan/.github" not in enabled
