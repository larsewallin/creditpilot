import { describe, it, expect } from "vitest";
import {
  analysePaymentBehaviour,
  PaymentTransaction,
} from "../analyse-payment-behaviour";

// Helper: build a transaction record
function tx(
  payment_date: string,
  days_early_late: number,
  on_time: boolean,
  amount = 10_000
): PaymentTransaction {
  return {
    payment_date,
    days_to_pay: 30 + days_early_late,
    days_early_late,
    on_time,
    amount,
  };
}

describe("analysePaymentBehaviour", () => {
  it("returns unknown health and null metrics for empty transactions", () => {
    const result = analysePaymentBehaviour([]);
    expect(result.on_time_rate).toBeNull();
    expect(result.avg_days_early_late).toBeNull();
    expect(result.recent_on_time_rate).toBeNull();
    expect(result.trend).toBe("insufficient_data");
    expect(result.total_transactions).toBe(0);
    expect(result.health).toBe("unknown");
  });

  it("returns unknown health and null metrics for null input", () => {
    const result = analysePaymentBehaviour(null as any);
    expect(result.on_time_rate).toBeNull();
    expect(result.health).toBe("unknown");
  });

  it("classifies a healthy customer correctly", () => {
    const transactions: PaymentTransaction[] = [
      tx("2025-01-15", -2, true),
      tx("2025-02-15", 0, true),
      tx("2025-03-15", -1, true),
      tx("2025-04-15", -3, true),
      tx("2025-05-15", 1, true),
      tx("2025-06-15", -2, true),
    ];
    const result = analysePaymentBehaviour(transactions);

    expect(result.on_time_rate).toBe(1);
    expect(result.health).toBe("healthy");
    expect(result.trend).not.toBe("deteriorating");
    expect(result.total_transactions).toBe(6);
  });

  it("flags a deteriorating customer as at_risk", () => {
    // Early transactions pay on time, later ones are increasingly late
    const transactions: PaymentTransaction[] = [
      tx("2025-01-01", -1, true),
      tx("2025-02-01", 0, true),
      tx("2025-03-01", 5, false),
      tx("2025-04-01", 12, false),
      tx("2025-05-01", 18, false),
      tx("2025-06-01", 25, false),
    ];
    const result = analysePaymentBehaviour(transactions);

    expect(result.on_time_rate).toBeLessThan(0.5);
    expect(result.trend).toBe("deteriorating");
    expect(result.health).toBe("at_risk");
  });

  it("handles a single transaction without crashing", () => {
    const result = analysePaymentBehaviour([tx("2025-06-01", 5, false)]);

    expect(result.total_transactions).toBe(1);
    expect(result.on_time_rate).toBe(0);
    expect(result.trend).toBe("insufficient_data");
  });

  it("detects improving trend when recent payments are earlier", () => {
    const transactions: PaymentTransaction[] = [
      tx("2025-01-01", 15, false),
      tx("2025-02-01", 12, false),
      tx("2025-03-01", -2, true),
      tx("2025-04-01", -3, true),
    ];
    const result = analysePaymentBehaviour(transactions);
    expect(result.trend).toBe("improving");
  });

  it("always-late but stable → health 'watch' not 'at_risk'", () => {
    // Consistently 15-20 days late across all transactions — bad but not getting worse
    const transactions: PaymentTransaction[] = [
      tx("2025-01-01", 20, false),
      tx("2025-02-01", 18, false),
      tx("2025-03-01", 22, false),
      tx("2025-04-01", 19, false),
    ];
    const result = analysePaymentBehaviour(transactions);
    // delta = (22+19)/2 - (20+18)/2 = 20.5 - 19 = 1.5 → stable (< 3)
    expect(result.trend).toBe("stable");
    // on_time_rate = 0 < 0.70 → watch (not at_risk — not deteriorating)
    expect(result.health).toBe("watch");
  });

  it("deteriorating trend with on_time_rate < 0.85 → at_risk", () => {
    const transactions: PaymentTransaction[] = [
      tx("2025-01-01", -2, true),
      tx("2025-02-01", 0, true),
      tx("2025-03-01", 2, true),
      tx("2025-04-01", 8, false),
      tx("2025-05-01", 10, false),
      tx("2025-06-01", 12, false),
    ];
    const result = analysePaymentBehaviour(transactions);
    // delta = avg(8,10,12) - avg(-2,0,2) = 10 - 0 = 10 > 3 → deteriorating
    // on_time_rate = 3/6 = 0.5 < 0.85 → at_risk
    expect(result.trend).toBe("deteriorating");
    expect(result.health).toBe("at_risk");
  });

  it("trend threshold: delta exactly 3 → stable, delta 4 → deteriorating", () => {
    // delta = 3 → stable (threshold is strictly > 3)
    const stable = analysePaymentBehaviour([
      tx("2025-01-01", 0, true),
      tx("2025-02-01", 3, true),
    ]);
    expect(stable.trend).toBe("stable");

    // delta = 4 → deteriorating
    const deter = analysePaymentBehaviour([
      tx("2025-01-01", 0, true),
      tx("2025-02-01", 4, true),
    ]);
    expect(deter.trend).toBe("deteriorating");
  });

  it("amount-weighted: large late payment lowers on_time_rate more than count suggests", () => {
    const transactions: PaymentTransaction[] = [
      tx("2025-01-01", 0, true, 1_000),    // small, on time
      tx("2025-02-01", 0, true, 1_000),    // small, on time
      tx("2025-03-01", 30, false, 100_000), // large, late
    ];
    const result = analysePaymentBehaviour(transactions);
    // Count-based would be 2/3 ≈ 0.67
    // Amount-weighted: 2000 / 102000 ≈ 0.020
    expect(result.on_time_rate).toBeLessThan(0.1);
  });

  it("calculates recent_on_time_rate from last 3 transactions", () => {
    const transactions: PaymentTransaction[] = [
      tx("2025-01-01", 10, false),
      tx("2025-02-01", 10, false),
      tx("2025-03-01", 10, false),
      // Last 3: all on time
      tx("2025-04-01", 0, true),
      tx("2025-05-01", 0, true),
      tx("2025-06-01", 0, true),
    ];
    const result = analysePaymentBehaviour(transactions);
    expect(result.recent_on_time_rate).toBe(1);
    expect(result.on_time_rate).toBeLessThan(1); // overall is lower
  });
});
