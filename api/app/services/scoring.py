"""健康度评分：五维度指标 → 综合分（0–100），纯函数、可复现、可下钻。

综合分公式（对应 §6.1）：`score = Σ_d w_d · dim_score_d`，
`dim_score_d = mean(各指标归一化分)`；指标归一化默认阈值分段线性（见 normalize.py）。
权重读自 health_weights.yaml；每个维度/指标都同时返回原始值与归一化分，
评分不留黑箱。
"""

from __future__ import annotations

from app.services.normalize import normalize_threshold, normalize_zscore, percentile_rank, zscore
from app.services.weights import DimensionConfig, HealthWeights


def _indicator_score(
    key: str,
    value: float,
    ind,
    bands: dict[str, float],
    method: str,
    samples: dict[str, list[float]] | None,
) -> dict:
    if method == "percentile" and samples and key in samples and len(samples[key]) > 1:
        score = percentile_rank(value, samples[key])
    elif method == "zscore" and samples and key in samples and len(samples[key]) > 1:
        sample = samples[key]
        mean = sum(sample) / len(sample)
        var = sum((v - mean) ** 2 for v in sample) / len(sample)
        std = var ** 0.5
        score = normalize_zscore(zscore(value, mean, std))
    else:
        score = normalize_threshold(value, direction=ind.direction, thresholds=ind.thresholds, bands=bands)
    return {
        "key": key,
        "label": ind.label,
        "direction": ind.direction,
        "value": round(float(value), 6),
        "score": round(score, 4),
    }


def score_dimension(
    dim: DimensionConfig,
    indicator_values: dict[str, float],
    *,
    bands: dict[str, float],
    weight: float,
    method: str,
    samples: dict[str, list[float]] | None = None,
) -> dict:
    """计算单个维度的指标归一化分与维度分。

    指标缺失时跳过（不计入均值）；维度无任何指标时得分为 0。
    """
    indicators = [
        _indicator_score(key, indicator_values[key], ind, bands, method, samples)
        for key, ind in dim.indicators.items()
        if key in indicator_values
    ]
    dim_score = sum(i["score"] for i in indicators) / len(indicators) if indicators else 0.0
    return {
        "key": dim.key,
        "label": dim.label,
        "weight": round(weight, 6),
        "score": round(dim_score, 4),
        "indicators": indicators,
    }


def compute_health_score(
    indicators: dict[str, float],
    config: HealthWeights,
    *,
    method: str | None = None,
    samples: dict[str, list[float]] | None = None,
) -> dict:
    """给定原始指标值与权重配置，返回综合分与五维明细（可下钻）。

    `method` 缺省用 config.normalization_method；`samples` 供 percentile/zscore
    归一化提供跨仓库参考样本，未提供时回落阈值归一化。
    """
    method = method or config.normalization_method
    bands = config.score_bands

    dimensions = [
        score_dimension(
            config.dimensions[key],
            indicators,
            bands=bands,
            weight=config.weights.get(key, 0.0),
            method=method,
            samples=samples,
        )
        for key in config.dimension_keys
    ]

    total_weight = sum(d["weight"] for d in dimensions)
    if total_weight > 0:
        composite = sum(d["score"] * d["weight"] for d in dimensions) / total_weight
    else:
        composite = 0.0

    return {
        "score": round(composite, 2),
        "dimensions": dimensions,
    }