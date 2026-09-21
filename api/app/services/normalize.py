"""指标归一化：阈值分段线性 / z-score / 百分位。

设计（对应架构 §6.1 的 `norm_d = clamp(0..100 的 z-score / 百分位归一化)`）：

- `normalize_threshold` 是默认路径：按配置阈值做分段线性映射，给定固定输入
  必然复现同一结果（评分可验证），且不依赖跨仓库样本。
- `zscore` / `percentile_rank` 用于跨仓库（截面）归一化，边界行为见各函数注释。
- 所有函数返回值一律落在 [0, 100]。
"""

from __future__ import annotations

from collections.abc import Sequence

DEFAULT_BANDS: dict[str, float] = {
    "excellent": 100.0,
    "good": 75.0,
    "poor": 40.0,
    "critical": 10.0,
}


def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """把 value 夹到 [lo, hi]。"""
    return max(lo, min(hi, value))


def _interp(x: float, x0: float, y0: float, x1: float, y1: float) -> float:
    """线性插值；x0 == x1 时返回 y0（避免除零）。"""
    if x0 == x1:
        return y0
    return y0 + (x - x0) * (y1 - y0) / (x1 - x0)


def normalize_threshold(
    value: float,
    *,
    direction: str,
    thresholds: dict[str, float],
    bands: dict[str, float] | None = None,
) -> float:
    """按阈值分段线性归一化到 0–100。

    direction ∈ {higher_better, lower_better}。

    higher_better：锚点 (0→critical, poor→poor_band, good→good_band,
    excellent→excellent_band)，value 在锚点间线性插值，>= excellent 封顶 100。
    lower_better：锚点 (excellent→100, good→75, poor→40, 2*poor→critical)，
    value <= excellent 封顶 100，>= 2*poor 触底 critical。
    """
    bands = {**DEFAULT_BANDS, **(bands or {})}
    excellent = float(thresholds["excellent"])
    good = float(thresholds["good"])
    poor = float(thresholds["poor"])

    if direction == "lower_better":
        # 越小越好：excellent < good < poor
        if value <= excellent:
            return bands["excellent"]
        if value >= 2 * poor:
            return bands["critical"]
        if value <= good:
            return _interp(value, excellent, bands["excellent"], good, bands["good"])
        if value <= poor:
            return _interp(value, good, bands["good"], poor, bands["poor"])
        return _interp(value, poor, bands["poor"], 2 * poor, bands["critical"])

    # higher_better（默认）：越大越好
    if value >= excellent:
        return bands["excellent"]
    if value >= good:
        return _interp(value, good, bands["good"], excellent, bands["excellent"])
    if value >= poor:
        return _interp(value, poor, bands["poor"], good, bands["good"])
    if value >= 0:
        return _interp(value, 0.0, bands["critical"], poor, bands["poor"])
    return bands["critical"]


def zscore(value: float, mean: float, std: float) -> float:
    """标准分 z = (value - mean) / std；std == 0 时返回 0（无离差）。"""
    if std == 0:
        return 0.0
    return (value - mean) / std


def zscore_of(values: Sequence[float]) -> list[float]:
    """返回序列内每个元素相对其自身的 z 值；样本 < 2 或方差为 0 时全为 0。"""
    n = len(values)
    if n < 2:
        return [0.0] * n
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    if var == 0:
        return [0.0] * n
    std = var ** 0.5
    return [zscore(v, mean, std) for v in values]


def normalize_zscore(z: float, *, spread: float = 15.0) -> float:
    """把 z 值线性映射到 0–100：norm = clamp(50 + z*spread, 0, 100)。

    z=0 → 50；z=±(50/spread) 触边。spread 控制区分度。
    """
    return clamp(50.0 + z * spread)


def percentile_rank(value: float, sample: Sequence[float]) -> float:
    """value 在 sample 中的百分位（0–100）。

    口径：100 * (#(x < value)) / n —— 标准“严格小于”百分位。

    边界约定（评分口径不可黑箱，边界必须明确）：
    - 空样本 → 50（中性，避免除零，代表“无参考可比较”）。
    - 单元素样本 → 50（无离差，等同 zscore std=0）。
    - value <= min(sample) → 0；value > max(sample) → 100。
    - value == max(sample) → 100*(n-1)/n（严格小于口径）。
    """
    n = len(sample)
    if n == 0:
        return 50.0
    if n == 1:
        return 50.0
    less = sum(1 for x in sample if x < value)
    return clamp(100.0 * less / n)