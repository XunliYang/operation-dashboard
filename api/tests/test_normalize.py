"""归一化边界：阈值分段线性、z-score、百分位。"""

from app.services.normalize import (
    clamp,
    normalize_threshold,
    normalize_zscore,
    percentile_rank,
    zscore,
    zscore_of,
)


def test_clamp():
    assert clamp(50) == 50
    assert clamp(-5) == 0
    assert clamp(150) == 100


def test_threshold_higher_better_bounds():
    th = {"excellent": 20, "good": 8, "poor": 2}
    assert normalize_threshold(20, direction="higher_better", thresholds=th) == 100
    assert normalize_threshold(100, direction="higher_better", thresholds=th) == 100
    assert normalize_threshold(0, direction="higher_better", thresholds=th) == 10  # critical
    assert normalize_threshold(-3, direction="higher_better", thresholds=th) == 10


def test_threshold_higher_better_interpolation():
    th = {"excellent": 20, "good": 8, "poor": 2}
    # good(75) → excellent(100)，value=14 在中间
    assert normalize_threshold(14, direction="higher_better", thresholds=th) == 87.5


def test_threshold_lower_better_bounds():
    th = {"excellent": 4, "good": 24, "poor": 72}
    assert normalize_threshold(1, direction="lower_better", thresholds=th) == 100
    assert normalize_threshold(4, direction="lower_better", thresholds=th) == 100
    assert normalize_threshold(144, direction="lower_better", thresholds=th) == 10  # 2*poor
    assert normalize_threshold(1000, direction="lower_better", thresholds=th) == 10


def test_zscore_std_zero_returns_zero():
    assert zscore(5, mean=5, std=0) == 0.0
    assert zscore(3, mean=2, std=1) == 1.0


def test_zscore_of_uniform_returns_zeros():
    assert zscore_of([4, 4, 4]) == [0.0, 0.0, 0.0]
    assert zscore_of([]) == []
    assert zscore_of([7]) == [0.0]


def test_normalize_zscore_mapping():
    assert normalize_zscore(0) == 50
    assert normalize_zscore(1000) == 100  # clamp 上限
    assert normalize_zscore(-1000) == 0  # clamp 下限
    assert normalize_zscore(1, spread=15) == 65


def test_percentile_rank_boundaries():
    assert percentile_rank(5, []) == 50  # 空样本 → 中性
    assert percentile_rank(5, [5]) == 50  # 单元素 → 中性
    sample = [10, 20, 30, 40]
    assert percentile_rank(5, sample) == 0    # 低于最小值
    assert percentile_rank(50, sample) == 100  # 高于最大值
    assert percentile_rank(40, sample) == 75  # == max → (n-1)/n*100
    assert percentile_rank(20, sample) == 25  # 严格小于 20 的只有 10


def test_percentile_rank_monotonic():
    sample = [1, 5, 5, 9, 12]
    ranks = [percentile_rank(v, sample) for v in range(0, 15)]
    assert ranks == sorted(ranks)