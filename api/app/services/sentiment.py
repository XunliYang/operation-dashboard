"""舆情只读服务（sentiment-monitor）的 BFF 支撑：映射加载 + 只读端点拉取。

LEOY-7 · Phase 3：主站 BFF 代理舆情只读端点，前端不直连舆情服务地址。
映射表使用显式 id（`config/sentiment_mapping.yaml` 的 `repo_project_map`），
禁止按名称模糊匹配（舆情 `projects.name` 是自由文本，无唯一性）。
"""

from __future__ import annotations

from pathlib import Path

import httpx
import yaml


def _mapping_candidates(config_dir: str):
    """按顺序尝试的映射文件路径：调用方指定目录，再到仓库根 `config/`。

    后者让 `cd api && uvicorn` 与 `cd <repo>` 两种 cwd 都能找到配置（与 weights.py 同构）。
    """
    yield Path(config_dir) / "sentiment_mapping.yaml"
    repo_root = Path(__file__).resolve().parents[3]  # services -> app -> api -> 仓库根
    yield repo_root / "config" / "sentiment_mapping.yaml"


def load_sentiment_mapping(config_dir: str) -> dict[str, int]:
    """加载 `repo (owner/name) -> sentiment_project_id` 的显式映射。

    文件缺失或未声明时返回空映射（该 repo 视为未映射，走 degraded 而非报错）。
    """
    for path in _mapping_candidates(config_dir):
        if not path.is_file():
            continue
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        mapping = raw.get("repo_project_map") or {}
        return {
            str(repo): int(pid)
            for repo, pid in mapping.items()
            if pid is not None
        }
    return {}


def fetch_sentiment_stats(
    base_url: str,
    project_id: int,
    frm: str | None,
    to: str | None,
    timeout: float,
    auth_token: str = "",
) -> dict | None:
    """调用舆情只读端点 `GET /api/projects/:id/sentiment/stats`。

    舆情不可用（连接失败 / 非 2xx / 项目不存在 404）一律返回 None，由路由层降级，
    绝不把舆情故障变成 BFF 的 500。
    """
    url = f"{base_url.rstrip('/')}/api/projects/{project_id}/sentiment/stats"
    params: dict[str, str] = {}
    if frm:
        params["from"] = frm
    if to:
        params["to"] = to
    headers = {"X-Sentiment-Token": auth_token} if auth_token else {}

    try:
        resp = httpx.get(url, params=params, headers=headers, timeout=timeout)
    except httpx.HTTPError:
        return None

    if resp.status_code != 200:
        return None
    try:
        return resp.json()
    except ValueError:
        return None
