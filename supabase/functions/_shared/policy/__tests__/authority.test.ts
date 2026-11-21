import { describe, expect, it } from "vitest";
import { authorityOf, mayApprove } from "../authority.ts";
import { effectivePolicy } from "../policy.ts";

const p = effectivePolicy();

describe("approval authority (founder, 2026-11-21)", () => {
  it("gives each role its amount: analyst $250k, manager $1M, admin no ceiling", () => {
    expect(authorityOf({ role: "credit_analyst" }, p)).toBe(250_000);
    expect(authorityOf({ role: "credit_manager" }, p)).toBe(1_000_000);
    expect(authorityOf({ role: "admin" }, p)).toBe(Infinity);
    expect(authorityOf({ role: "sales" }, p)).toBe(0);
  });

  it("uses a person's own amount over the role's, 0 included", () => {
    expect(authorityOf({ role: "credit_analyst", approval_limit_usd: 500_000 }, p)).toBe(500_000);
    expect(authorityOf({ role: "admin", approval_limit_usd: 0 }, p)).toBe(0);
  });

  it("lets anyone who approves cut a limit, and checks authority on a new or higher limit", () => {
    expect(mayApprove({ role: "credit_analyst" }, p, 300_000)).toBe(false);
    expect(mayApprove({ role: "credit_analyst" }, p, 250_000)).toBe(true);
    expect(mayApprove({ role: "credit_analyst" }, p, 2_000_000, 3_000_000)).toBe(true);
    expect(mayApprove({ role: "credit_manager" }, p, 1_200_000, 900_000)).toBe(false);
    expect(mayApprove({ role: "viewer" }, p, 1_000, 5_000)).toBe(false);
  });

  it("follows the company's policy", () => {
    const strict = effectivePolicy({ "policy.approvals": { credit_manager_usd: 500_000 } });
    expect(authorityOf({ role: "credit_manager" }, strict)).toBe(500_000);
  });
});
