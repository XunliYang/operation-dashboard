"""评分计算：可复现、权重敏感、可下钻、指标缺失兜底。"""

from app.services.scoring import compute_health_score
from app.services.weights import load_health_weights

INDICATORS = {
    "commits": 30,
    "active_contributors": 4,
    "prs_merged": 5,
    "issues_closed": 3,
    "pr_first_review_median_hours": 10,
    "pr_merge_median_hours": 30,
    "review_coverage": 0.7,
    "stale_open_ratio": 0.1,
    "ci_success_rate": 0.9,
    "bug_issue_ratio": 0.15,
    "star_growth": 5,
    "fork_growth": 2,
    "new_contributors": 2,
    "bus_factor_top1": 0.5,
    "bus_factor_top3": 0.8,
    "contributor_retention": 0.5,
}


def _write_weights(tmp_path, weights: dict[str, float]) -> str:
    text = f"""
weights:
  activity: {weights['activity']}
  collaboration: {weights['collaboration']}
dimensions:
  activity:
    label: 活跃度
    indicators:
      commits:
        label: 提交数
        direction: higher_better
        thresholds: {{ excellent: 20, good: 8, poor: 2 }}
      active_contributors:
        label: 活跃贡献者
        direction: higher_better
        thresholds: {{ excellent: 5, good: 2, poor: 1 }}
  collaboration:
    label: 协作效率
    indicators:
      pr_first_review_median_hours:
        label: 首评耗时
        direction: lower_better
        thresholds: {{ excellent: 4, good: 24, poor: 72 }}
      review_coverage:
        label: Review 覆盖率
        direction: higher_better
        thresholds: {{ excellent: 0.8, good: 0.5, poor: 0.2 }}
score_bands:
  excellent: 100
  good: 75
  poor: 40
  critical: 10
normalization:
  method: threshold
"""
    path = tmp_path / "health_weights.yaml"
    path.write_text(text, encoding="utf-8")
    return str(tmp_path)


def test_score_is_reproducible(tmp_path):
    config = load_health_weights(_write_weights(tmp_path, {"activity": 0.5, "collaboration": 0.5}))
    first = compute_health_score(INDICATORS, config)
    second = compute_health_score(INDICATORS, config)
    assert first == second
    assert 0 <= first["score"] <= 100


def test_changing_weights_changes_score(tmp_path):
    config_a = load_health_weights(_write_weights(tmp_path, {"activity": 0.9, "collaboration": 0.1}))
    config_b = load_health_weights(_write_weights(tmp_path, {"activity": 0.1, "collaboration": 0.9}))
    score_a = compute_health_score(INDICATORS, config_a)["score"]
    score_b = compute_health_score(INDICATORS, config_b)["score"]
    assert score_a != score_b


def test_composite_matches_weighted_formula(tmp_path):
    config = load_health_weights(_write_weights(tmp_path, {"activity": 0.5, "collaboration": 0.5}))
    result = compute_health_score(INDICATORS, config)
    dims = result["dimensions"]
    total_w = sum(d["weight"] for d in dims)
    expected = sum(d["score"] * d["weight"] for d in dims) / total_w
    assert result["score"] == round(expected, 2)


def test_each_dimension_drills_down_to_indicators(tmp_path):
    config = load_health_weights(_write_weights(tmp_path, {"activity": 0.5, "collaboration": 0.5}))
    result = compute_health_score(INDICATORS, config)
    assert {d["key"] for d in result["dimensions"]} == {"activity", "collaboration"}
    for dim in result["dimensions"]:
        for ind in dim["indicators"]:
            # 原始指标值 + 归一化分 都必须暴露（不可黑箱）
            assert "value" in ind and "score" in ind
            assert 0 <= ind["score"] <= 100


def test_missing_indicators_are_skipped(tmp_path):
    config = load_health_weights(_write_weights(tmp_path, {"activity": 0.5, "collaboration": 0.5}))
    # 只给 collaboration 指标，activity 无指标 → 该维度 0 分，不除零
    result = compute_health_score({"review_coverage": 0.9}, config)
    activity = next(d for d in result["dimensions"] if d["key"] == "activity")
    assert activity["score"] == 0.0
    assert activity["indicators"] == []


def test_empty_indicators_yield_zero_score(tmp_path):
    config = load_health_weights(_write_weights(tmp_path, {"activity": 0.5, "collaboration": 0.5}))
    result = compute_health_score({}, config)
    assert result["score"] == 0.0