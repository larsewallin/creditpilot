import { describe, it, expect } from "vitest";
import { assessCompositeRisk } from "../assess-composite-risk";

describe("assessCompositeRisk", () => {
  // ── No signals ──────────────────────────────────────────────────────────────

  it("no signals, good credit score → info severity, no action", () => {
    const result = assessCompositeRisk({
      utilization_pct: 70,
      credit_score: 75,
      active_event_types: [],
      agents_flagging: [],
    });
    expect(result.severity).toBe("info");
    expect(result.recommend_action).toBe(false);
    expect(result.adjusted_threshold).toBe(75);
    expect(result.adjustments).toHaveLength(0);
  });

  // ── Single signal — threshold adjustment ────────────────────────────────────

  it("NEGATIVE_NEWS_HIGH → threshold drops to 65%, util 62% → no action", () => {
    const result = assessCompositeRisk({
      utilization_pct: 62,
      credit_score: 60,
      active_event_types: ["NEGATIVE_NEWS_HIGH"],
      agents_flagging: ["news-monitor-agent"],
    });
    expect(result.adjusted_threshold).toBe(65); // 75-10=65
    expect(result.recommend_action).toBe(false);
    expect(result.severity).toBe("medium");
  });

  it("NEGATIVE_NEWS_HIGH → threshold 65%, util 66% → recommend action, medium severity", () => {
    const result = assessCompositeRisk({
      utilization_pct: 66,
      credit_score: 60,
      active_event_types: ["NEGATIVE_NEWS_HIGH"],
      agents_flagging: ["news-monitor-agent"],
    });
    expect(result.adjusted_threshold).toBe(65); // 75-10=65
    expect(result.recommend_action).toBe(true);
    expect(result.severity).toBe("medium");
  });

  // ── Multi-signal threshold stacking ─────────────────────────────────────────

  it("NEGATIVE_NEWS_HIGH + COVENANT_WAIVER → threshold 53% (−10 −12)", () => {
    const result = assessCompositeRisk({
      utilization_pct: 64,
      credit_score: 50,
      active_event_types: ["NEGATIVE_NEWS_HIGH", "COVENANT_WAIVER"],
      agents_flagging: ["news-monitor-agent", "sec-monitor-agent"],
    });
    expect(result.adjusted_threshold).toBe(53); // 75-10-12=53
    expect(result.recommend_action).toBe(true); // util 64 >= threshold 53
    expect(result.severity).toBe("high"); // 2 agents
  });

  it("NEGATIVE_NEWS_HIGH + COVENANT_WAIVER + GOING_CONCERN_WARNING → threshold floor 40% (−10 −12 −15)", () => {
    const result = assessCompositeRisk({
      utilization_pct: 51,
      credit_score: 45,
      active_event_types: ["NEGATIVE_NEWS_HIGH", "COVENANT_WAIVER", "GOING_CONCERN_WARNING"],
      agents_flagging: ["news-monitor-agent", "sec-monitor-agent", "ar-aging-agent"],
    });
    // delta=37 → 75-37=38, floor at 40
    expect(result.adjusted_threshold).toBe(40);
    expect(result.recommend_action).toBe(true); // util 51 >= threshold 40, also 3 agents
    expect(result.severity).toBe("critical"); // 3 agents
  });

  // ── Distress credit score ────────────────────────────────────────────────────

  it("credit_score < 20 with any active signal → recommend_action true regardless of util", () => {
    const result = assessCompositeRisk({
      utilization_pct: 30, // well below any threshold
      credit_score: 15,
      active_event_types: ["CEO_DEPARTURE"],
      agents_flagging: ["news-monitor-agent"],
    });
    expect(result.recommend_action).toBe(true);
    expect(result.severity).toBe("high"); // 1 agent + distress score
  });

  it("credit_score < 20 but NO active signals → no forced action", () => {
    const result = assessCompositeRisk({
      utilization_pct: 30,
      credit_score: 10,
      active_event_types: [],
      agents_flagging: [],
    });
    // inDistress && hasActiveSignals = false; util 30 < adjusted_threshold 60 (75-15)
    expect(result.recommend_action).toBe(false);
    expect(result.adjusted_threshold).toBe(60);
  });

  // ── Agent count severity ─────────────────────────────────────────────────────

  it("3 agents flagging → critical severity and recommend_action true", () => {
    const result = assessCompositeRisk({
      utilization_pct: 50,
      credit_score: 55,
      active_event_types: ["OVERDUE_BUCKET_OVER_90", "NEGATIVE_NEWS_HIGH", "COVENANT_WAIVER"],
      agents_flagging: ["ar-aging-agent", "news-monitor-agent", "sec-monitor-agent"],
    });
    expect(result.severity).toBe("critical");
    expect(result.recommend_action).toBe(true);
  });

  // ── Threshold floor ──────────────────────────────────────────────────────────

  it("CREDIT_RATING_DOWNGRADE → threshold drops 10pp to 65%", () => {
    const result = assessCompositeRisk({
      utilization_pct: 60,
      credit_score: 60,
      active_event_types: ["CREDIT_RATING_DOWNGRADE"],
      agents_flagging: ["ar-aging-agent"],
    });
    expect(result.adjusted_threshold).toBe(65); // 75-10=65
    expect(result.adjustments).toContain("CREDIT_RATING_DOWNGRADE (−10pp)");
  });

  it("COVENANT_WAIVER alone → threshold drops 12pp to 63%", () => {
    const result = assessCompositeRisk({
      utilization_pct: 60,
      credit_score: 60,
      active_event_types: ["COVENANT_WAIVER"],
      agents_flagging: ["sec-monitor-agent"],
    });
    expect(result.adjusted_threshold).toBe(63); // 75-12=63
    expect(result.adjustments).toContain("COVENANT_WAIVER (−12pp)");
  });

  it("on_time_rate 0.40 → paymentPenalty 15pp lowers threshold to 60%", () => {
    const result = assessCompositeRisk({
      utilization_pct: 55,
      credit_score: 60,
      active_event_types: [],
      agents_flagging: [],
      on_time_rate: 0.40,
    });
    expect(result.adjusted_threshold).toBe(60); // 75-15=60
    expect(result.adjustments).toContain("on_time_rate <50% (−15pp)");
  });

  it("single agent + active high-severity signal → severity high", () => {
    const result = assessCompositeRisk({
      utilization_pct: 50,
      credit_score: 50,
      active_event_types: ["NEGATIVE_NEWS_HIGH"],
      agents_flagging: ["news-monitor-agent"],
      active_signal_severities: ["high"],
    });
    expect(result.severity).toBe("high");
  });

  it("many signals combined cannot push threshold below 40% floor", () => {
    const result = assessCompositeRisk({
      utilization_pct: 35,
      credit_score: 10, // distress −15pp
      active_event_types: [
        "NEGATIVE_NEWS_CRITICAL", // −10pp
        "GOING_CONCERN_WARNING",  // −15pp
        "COVENANT_WAIVER",        // −10pp
        "CEO_DEPARTURE",          // −5pp
      ],
      agents_flagging: ["ar-aging-agent", "news-monitor-agent", "sec-monitor-agent"],
    });
    // Raw delta: 10+15+12+5+15 = 57pp → 75-57 = 18, but floor is 40
    expect(result.adjusted_threshold).toBe(40);
  });
});
