import { describe, it, expect } from "vitest";
import { analysePaymentTrend, type PaymentTrendTransaction } from "../analyse-payment-trend";

// Fixed reference date so "current window" / "prior window" are deterministic.
const NOW = new Date("2026-09-23T00:00:00Z");

function tx(daysAgo: number, days_early_late: number | null): PaymentTrendTransaction {
  const d = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return { payment_date: d.toISOString().slice(0, 10), days_early_late };
}

describe("analysePaymentTrend", () => {
  // ── Insufficient data ────────────────────────────────────────────────────────

  it("no transactions at all → insufficient data", () => {
    const result = analysePaymentTrend([], NOW);
    expect(result.has_sufficient_data).toBe(false);
    expect(result.current_window_count).toBe(0);
    expect(result.prior_window_count).toBe(0);
  });

  it("transactions only in the current window (none prior) → insufficient data", () => {
    const transactions = [tx(5, 10), tx(10, 12)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.has_sufficient_data).toBe(false);
    expect(result.current_window_count).toBe(2);
    expect(result.prior_window_count).toBe(0);
  });

  it("transactions only in the prior window (none current) → insufficient data", () => {
    const transactions = [tx(35, 10), tx(50, 12)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.has_sufficient_data).toBe(false);
    expect(result.current_window_count).toBe(0);
    expect(result.prior_window_count).toBe(2);
  });

  // ── Deterioration ────────────────────────────────────────────────────────────

  it("swing of exactly 5 days with positive current avg → medium deterioration", () => {
    // prior avg = 0, current avg = 5 → swing = 5
    const transactions = [tx(5, 5), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.has_sufficient_data).toBe(true);
    expect(result.deterioration).toEqual({ trend_direction: "worsening", severity: "medium" });
    expect(result.improvement).toBeNull();
  });

  it("swing of 15 days → high deterioration, sharply_worsening", () => {
    // prior avg = 0, current avg = 15 → swing = 15
    const transactions = [tx(5, 15), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.deterioration).toEqual({ trend_direction: "sharply_worsening", severity: "high" });
  });

  it("swing of 25 days → critical deterioration", () => {
    // prior avg = 0, current avg = 25 → swing = 25
    const transactions = [tx(5, 25), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.deterioration).toEqual({ trend_direction: "sharply_worsening", severity: "critical" });
  });

  it("swing >= 5 but current_avg_days_late <= 0 → no deterioration (still paying early overall)", () => {
    // prior avg = -20 (very early), current avg = -10 (less early) → swing = 10, but current <= 0
    const transactions = [tx(5, -10), tx(40, -20)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.current_avg_days_late).toBe(-10);
    expect(result.deterioration).toBeNull();
  });

  it("swing under 5 days → no deterioration and no improvement (stable)", () => {
    const transactions = [tx(5, 3), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.deterioration).toBeNull();
    expect(result.improvement).toBeNull();
  });

  // ── Improvement ──────────────────────────────────────────────────────────────

  it("prior-minus-current swing of exactly 5 days with positive prior avg → info improvement", () => {
    // prior avg = 10, current avg = 5 → improvement magnitude = 5
    const transactions = [tx(5, 5), tx(40, 10)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.improvement).toEqual({ trend_direction: "improving", severity: "info" });
    expect(result.deterioration).toBeNull();
  });

  it("improvement magnitude of 15 days → low severity, sharply_improving", () => {
    // prior avg = 20, current avg = 5 → improvement magnitude = 15
    const transactions = [tx(5, 5), tx(40, 20)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.improvement).toEqual({ trend_direction: "sharply_improving", severity: "low" });
  });

  it("improvement magnitude of 30 days → severity capped at low (not escalated)", () => {
    // prior avg = 35, current avg = 5 → improvement magnitude = 30
    const transactions = [tx(5, 5), tx(40, 35)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.improvement).toEqual({ trend_direction: "sharply_improving", severity: "low" });
  });

  it("prior_avg_days_late <= 0 → no improvement even if swing qualifies (already paying early)", () => {
    // prior avg = -2 (already early), current avg = -10 (even earlier) → magnitude = 8, but prior <= 0
    const transactions = [tx(5, -10), tx(40, -2)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.improvement).toBeNull();
  });

  // ── Volatility ───────────────────────────────────────────────────────────────

  it("stable current-window timing (low stddev) → no volatility", () => {
    const transactions = [tx(2, 5), tx(9, 6), tx(16, 4), tx(23, 5), tx(40, 5)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.volatility).toBeNull();
  });

  it("current-window stddev >= 10 → high volatility", () => {
    // Values: -15, 15 around mean 0 → population stddev = 15
    const transactions = [tx(2, -15), tx(20, 15), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.volatility).not.toBeNull();
    expect(result.volatility!.severity).toBe("high");
    expect(result.volatility!.standard_deviation_days).toBe(15);
  });

  it("current-window stddev >= 20 → critical volatility", () => {
    // Values: -25, 25 around mean 0 → population stddev = 25
    const transactions = [tx(2, -25), tx(20, 25), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.volatility!.severity).toBe("critical");
    expect(result.volatility!.standard_deviation_days).toBe(25);
  });

  it("volatility fires independently alongside a deterioration signal in the same run", () => {
    // Current window: -15, 25 → avg = 5, stddev = 20 (critical volatility)
    // Prior window: 0 → avg = 0 → swing = 5 → medium deterioration
    const transactions = [tx(2, -15), tx(20, 25), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.deterioration).not.toBeNull();
    expect(result.volatility).not.toBeNull();
  });

  // ── Window boundary / data hygiene ──────────────────────────────────────────

  it("ignores transactions with null days_early_late", () => {
    const transactions = [tx(5, 10), tx(6, null), tx(40, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.current_window_count).toBe(1);
  });

  it("a transaction exactly 30 days ago falls in the current window, not the prior window", () => {
    const transactions = [tx(30, 8), tx(45, 0)];
    const result = analysePaymentTrend(transactions, NOW);
    expect(result.current_window_count).toBe(1);
    expect(result.prior_window_count).toBe(1);
  });
});
