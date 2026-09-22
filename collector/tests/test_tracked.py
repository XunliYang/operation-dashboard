"""追踪仓库清单加载（`config/tracked_repos.yaml`）。"""

from pathlib import Path

import yaml

from collector.tracked import load_tracked_repos

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"


def test_load_tracked_repos_returns_14_openan_repos():
    repos = load_tracked_repos(str(CONFIG_DIR))

    names = [r["repo"] for r in repos]
    assert len(repos) == 14
    assert all(name.startswith("project-openan/") for name in names)
    assert all(r["org"] == "openan" for r in repos)


def test_org_config_repo_is_included():
    names = [r["repo"] for r in load_tracked_repos(str(CONFIG_DIR))]

    assert "project-openan/.github" in names


def test_org_mapping_openan_is_self_consistent_with_tracked_repos():
    mapping = yaml.safe_load((CONFIG_DIR / "org_mapping.yaml").read_text(encoding="utf-8"))
    enabled = {r["repo"] for r in load_tracked_repos(str(CONFIG_DIR))}

    assert mapping["default_org"] == "openan"
    assert set(mapping["orgs"]["openan"]["repos"]) == enabled
    assert "project-openan/.github" in mapping["orgs"]["openan"]["repos"]
