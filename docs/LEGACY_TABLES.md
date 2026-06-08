# Legacy Tables

These tables were created in the initial scaffold (February 2026)
and are not currently used by any active agent.
Preserved for potential future use — do not reference in new code without a plan.

| Table | Created | Status | Notes |
|-------|---------|--------|-------|
| bankruptcy_details | Feb 2026 | Seed-only — read by frontend via `v_bankruptcy_claims`; no agent reads or writes | 4 rows. Contains detailed bankruptcy tracking (chapter, status, claim amounts, recovery estimates). Frontend reads via `v_bankruptcy_claims` which joins to `invoices.claimable`. No agent writer — do not build agent logic that assumes these rows are maintained. See `docs/DEMO_DATA_CONTRACT.md`. |
| growth_signals | Feb 2026 | Seed-only — read by frontend via `v_growth_opportunities`; no agent reads or writes | 5 rows. Contains credit-limit-increase recommendations and growth trajectory data. Frontend reads via `v_growth_opportunities`. No agent writer (`agent_name` is NULL for all rows). See `docs/DEMO_DATA_CONTRACT.md`. |
| credit_actions | Feb 2026 | Unused | Superseded by pending_actions + credit_events |
| credit_metrics | Feb 2026 | Fully orphaned | Altman Z removed from decisions and UI (Apr 27 2026). No agent writes to it, no frontend reads it. Contains: credit_score, altman_z_score, d_and_b_rating, current_ratio. credit_rating_score on customers table is the authoritative score. calculate-altman-z.ts skill also removed (May 2026) — requires financial statement inputs not available via API. credit_metrics table remains orphaned. |

---

## Columns dropped in B5

These columns were dropped in B5 (migration 20260607230000), along with the paired view rewrites that had blocked them. Listed here as historical record.

| Column | Table | Blocked by | Notes |
|--------|-------|-----------|-------|
| `flags` | `customers` | `v_customers_at_risk`, `v_portfolio_overview` (rewritten in B5) | Pre-V1-taxonomy cruft. 38 distinct values across 28 customers, none read by any agent. Event-like values (EARNINGS_MISS, COVENANT_WAIVER, etc.) are represented in the V1 taxonomy as proper credit_events types. |
| `paid_on_time` | `payment_transactions` | `v_customers_at_risk`, `v_payment_behaviour` (rewritten in B5) | Legacy boolean duplicate of `on_time`. `on_time` is the canonical field (fully populated as of B0 Phase 4g). |

---

## Columns dropped in B0

These columns were removed during the B0 demo data rebuild. Recorded here for audit trail.

| Column | Table | Migration | Notes |
|--------|-------|-----------|-------|
| `dso_days` | `ar_aging_snapshots` | `20260605140000_b0_drop_dso_days.sql` | No readers. Compute at read time if ever needed. Views `v_ar_aging_current` and `v_ar_aging_portfolio` rewritten to remove the passthrough. |
| `next_dunning_date` | `invoices` | `20260605150000_b0_drop_next_dunning_date.sql` | 0/160 rows populated, no readers. View `v_overdue_invoices` rewritten to remove the passthrough. |
| `amount` | `invoices` | `20260602180000_drop_b0_legacy_columns.sql` | Legacy duplicate of `invoice_amount`. No agent readers. |
| `paid_amount` | `invoices` | `20260602180000_drop_b0_legacy_columns.sql` | Legacy duplicate of `amount_paid`. No agent readers. |
| `dunning_level` | `invoices` | `20260602180000_drop_b0_legacy_columns.sql` | Legacy integer encoding of dunning stage. No agent readers. |
| `amount` | `payment_transactions` | `20260602180000_drop_b0_legacy_columns.sql` | Legacy numeric duplicate of `amount_paid`. No agent readers. Note: `ar-aging-agent` still selects `amount` in its payment_transactions query — will silently fall back to equal-weighting (backlog F3, fix post-B0). |
