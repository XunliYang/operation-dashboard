"""健康度权重配置（`config/health_weights.yaml`）加载与类型化。

权重只读加载并缓存；指标口径（方向 / 阈值）全部来自配置，评分不留黑箱。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_WEIGHTS = {"activity": 0.25, "collaboration": 0.25, "quality": 0.20, "community": 0.15, "sustainability": 0.15}


@dataclass(frozen=True)
class IndicatorConfig:
    key: str
    label: str
    direction: str
    thresholds: dict[str, float]


@dataclass(frozen=True)
class DimensionConfig:
    key: str
    label: str
    indicators: dict[str, IndicatorConfig] = field(default_factory=dict)


@dataclass(frozen=True)
class HealthWeights:
    weights: dict[str, float]           # 维度键 -> 权重（已归一化，合计 1.0）
    dimensions: dict[str, DimensionConfig]
    score_bands: dict[str, float]
    normalization_method: str

    @property
    def dimension_keys(self) -> tuple[str, ...]:
        return tuple(self.dimensions)


def _normalize_weights(raw: dict[str, float]) -> dict[str, float]:
    total = sum(raw.values())
    if total <= 0:
        return {k: v for k, v in DEFAULT_WEIGHTS.items()}
    return {k: v / total for k, v in raw.items()}


def _parse(raw: dict) -> HealthWeights:
    weights = _normalize_weights({k: float(v) for k, v in raw.get("weights", DEFAULT_WEIGHTS).items()})
    score_bands = {k: float(v) for k, v in raw.get("score_bands", {}).items()}

    dimensions: dict[str, DimensionConfig] = {}
    for dim_key, dim_raw in raw.get("dimensions", {}).items():
        indicators: dict[str, IndicatorConfig] = {}
        for ind_key, ind_raw in dim_raw.get("indicators", {}).items():
            indicators[ind_key] = IndicatorConfig(
                key=ind_key,
                label=ind_raw.get("label", ind_key),
                direction=ind_raw.get("direction", "higher_better"),
                thresholds={
                    k: float(v) for k, v in ind_raw.get("thresholds", {}).items() if k in {"excellent", "good", "poor"}
                },
            )
        dimensions[dim_key] = DimensionConfig(
            key=dim_key,
            label=dim_raw.get("label", dim_key),
            indicators=indicators,
        )
    return HealthWeights(
        weights=weights,
        dimensions=dimensions,
        score_bands=score_bands or {"excellent": 100.0, "good": 75.0, "poor": 40.0, "critical": 10.0},
        normalization_method=raw.get("normalization", {}).get("method", "threshold"),
    )


def _config_candidates(config_dir: str):
    """按顺序尝试的配置路径：调用方指定的目录，再到仓库根 `config/`。

    后者让 `cd api && uvicorn` 与 `cd <repo>` 两种 cwd 都能找到配置。
    """
    yield Path(config_dir) / "health_weights.yaml"
    repo_root = Path(__file__).resolve().parents[3]  # services -> app -> api -> 仓库根
    yield repo_root / "config" / "health_weights.yaml"


def load_health_weights(config_dir: str) -> HealthWeights:
    """从 `health_weights.yaml` 加载；文件缺失时回退到内置默认（五维等权）。"""
    for path in _config_candidates(config_dir):
        if path.is_file():
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            return _parse(raw)
    return _parse({"weights": DEFAULT_WEIGHTS})