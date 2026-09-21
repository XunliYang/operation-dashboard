"""追踪仓库清单（`config/tracked_repos.yaml`）加载。"""

from __future__ import annotations

from pathlib import Path

import yaml


def load_tracked_repos(config_dir: str) -> list[dict]:
    path = Path(config_dir) / "tracked_repos.yaml"
    if not path.is_file():
        return []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return [r for r in raw.get("repos", []) if r.get("enabled", True)]