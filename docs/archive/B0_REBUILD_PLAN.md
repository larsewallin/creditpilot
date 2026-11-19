# CreditPilot — B0 Demo Data Rebuild Plan

**Status:** ✅ COMPLETE — 2026-06-06
**Decision date:** 2026-06-02
**Chosen path:** Option B (Option 3-revised) — fix-in-place with schema additions and seed cleanup, preserve existing personas.

---

## B0 Completion Summary

All six phases complete. Migrations applied and committed to `main`.

### Migrations applied (in order)

| Migration | Description |
|-----------|-------------|
| `20260524001908_seed_news.sql` | seed_news table + 5 articles for News agent demo parity |
| `20260602180000_drop_b0_legacy_columns.sql` | Drop legacy duplicate columns on invoices + payment_transactions |
| `20260602180100_add_country_code_to_customers.sql` | Add country_code to customers (58 US, 1 DK) |
| `20260602180200_create_customer_identifiers.sql` | customer_identifiers table |
| `20260603120000_b0_phase4_data_easy.sql` | on_time backfill; country_code=DK for Liqtech; migrate CIK/ticker to customer_identifiers; delete 32 stale negative_news rows |
| `20260604120000_b0_phase4_invoice_consistency.sql` | Invoice amount consistency; pre_petition days_overdue=0; exposure + snapshot re-derivation. Portfolio: $80,140,000. |
| `20260605130000_b0_phase4g_payment_realism.sql` | Regen all payment_transactions (472 rows, persona-aligned) + backfill customers.payment_* for all 59. 27 healthy / 10 watch / 22 at_risk. |
| `20260605140000_b0_drop_dso_days.sql` | Drop ar_aging_snapshots.dso_days; rewrite v_ar_aging_current + v_ar_aging_portfolio |
| `20260605150000_b0_drop_next_dunning_date.sql` | Drop invoices.next_dunning_date; rewrite v_overdue_invoices |

### Agent refactors delivered alongside B0

| Commit | Description |
|--------|-------------|
| `63ba803` | News agent: publishEvent + NEWS_EVENT + demo parity via seed_news |
| `e9825a2` | AR agent: utilization-only rebuild on reference pattern |

### B5-deferred drops (NOT done in B0)

Two column drops remain blocked by view dependency and are deferred to B5:

- `customers.flags` — no agent readers; blocked by `v_customers_at_risk` + `v_portfolio_overview` which reference it. Needs paired view-rewrite migration with B5 ranking-rule encoding.
- `payment_transactions.paid_on_time` — no agent readers; blocked by `v_customers_at_risk` + `v_payment_behaviour`. Same dependency.

### Bugs surfaced, worked around, logged (F1–F5)

See `docs/CreditPilot_Deferred_Backlog.md` section F for full details.

- **F1:** `fn_refresh_ar_aging` missing pre_petition guard on mid-range buckets (workaround: set days_overdue=0 on pre_petition invoices)
- **F2:** Demo aging time is frozen (workaround: left as-is; frozen as-of date is accurate for demo)
- **F3:** AR agent reads dropped `payment_transactions.amount` column (non-tipping in demo; fix post-B0)
- **F4:** `total_outstanding` excludes pre_petition_amount ($2.24M gap vs true exposure)
- **F5:** `sec_monitoring` live schema has drifted from migrations (6 unmigrated columns; needs catch-up migration before next DB reset)

### Harness result

CIA harness 8/8 (with one re-run for pre-existing q1 flakiness, unrelated to B0 changes).

---

## Why this exists

Three sessions of agent work surfaced foundational data inconsistencies — utilization snapshot drift (~15 customers), Heliogen CIK error (and probably more), now `current_exposure` apparently disconnected from invoice activity. Each new agent built on top discovered the rot the hard way. The demo data was layered over time (Lovable era + each session's additions + manual fixes) and never audited for internal consistency.

User's instinct (correct): demo data needs to be **rock solid** before more agents are built on top. B0 is the deliberate fix.

---

## What we found in the audit (2026-06-02)

Investigation focused on `customers.current_exposure` and the `invoices` table. Confirmed:

### Real schema-level issues on `invoices`

The table has **three pairs of duplicate-looking columns** from successive design layers, plus one demo-data inconsistency:

1. **`amount_outstanding` (generated) vs `outstanding_amount` (stored)** — NOT duplicates. They serve different purposes:
   - `amount_outstanding` = generated column, `invoice_amount − amount_paid`. The exposure trigger (`fn_recalculate_exposure`) reads this.
   - `outstanding_amount` = a stored numeric, populated directly by the **CSV upload path** (`ar-csv-upload` writes it, `parse-ar-csv` parses CSV "Balance"/"Outstanding"/etc into it). The CIA reads this for invoice answers.
   - These should agree but currently don't, because demo `amount_paid` was wrong for some statuses.
   - **Keep both** — they're load-bearing for different code paths.

2. **`invoice_amount` (bigint) vs `amount` (numeric, defaults 0)** — `amount` is NOT read by any agent (greps clean). Pure legacy. **Dropped in B0 Phase 3.**

3. **`amount_paid` (bigint) vs `paid_amount` (numeric, defaults 0)** — `paid_amount` NOT read by any agent. Pure legacy. **Dropped in B0 Phase 3.**

4. **`dunning_stage` (enum) vs `dunning_level` (integer)** — `dunning_level` NOT read by any agent. Pure legacy. **Dropped in B0 Phase 3.**

### Real demo-data inconsistencies

5. **`amount_paid = 0` for all 160 invoices**, including paid ones. Fixed in B0 Phase 4.

6. **`outstanding_amount` was partially populated** — inconsistent rule by status. Reconciled in B0 Phase 4.

7. **`current_exposure` accidentally correct** for now: trigger filters out paid/written_off, so bad amount_paid values didn't reach it.

### Previously-discovered data issues addressed in B0

- D0c: payment_transactions data uniformly produced `payment_health='watch'` — fixed by regen (Phase 4g).
- D0b: ~32 stale hand-placed negative_news rows — deleted in Phase 4.
- Heliogen CIK was wrong (fixed); CIK/ticker data migrated to `customer_identifiers` for Phase 4.
- `ar_aging_snapshots.utilization_pct` and `credit_limit` were systematically inconsistent — rebuilt via `fn_refresh_all_ar_aging` in Phase 4.

### Things confirmed legitimate (NOT legacy)

After audit, three tables initially listed in `docs/LEGACY_TABLES.md` as "unused" are confirmed active:

- **`sec_monitoring`** — read and written by sec-monitor-agent.
- **`bankruptcy_details`** — 4 rows, read by frontend via `v_bankruptcy_claims`.
- **`growth_signals`** — 5 rows, read by frontend via `v_growth_opportunities`.

These have been removed from LEGACY_TABLES.md and documented in DEMO_DATA_CONTRACT.md.

---

## The plan — Option B (fix-in-place with additions)

Reject Option A (full rebuild from new personas) — we'd lose 3 sessions of tuned narrative (Triumph, the news seeds, the SEC seeds, harness calibration).
Reject Option C (minimal data fix) — leaves the underlying issues, doesn't deliver "rock solid."

**Option B = keep the 59 customers and their narrative; correct their data; add what's missing; remove what's truly legacy.**

### Phase 1 — Finish the audit ✅ DONE

**Customers audit COMPLETED 2026-06-02.**

- `country_code` did not exist → added in Phase 3.
- `credit_rating_*` fields are clean.
- `flags` is pure cruft → B5-deferred drop.
- `risk_tags` is canonical — CIA reads and writes it.
- `payment_transactions.on_time` was null for 91% → backfilled in Phase 4.
- 10 customers had NULL headquarters AND ticker AND sec_cik (private/invented demo customers) → assigned country_code='US'.
- Liqtech International AS (Denmark) → country_code='DK'.

Remaining audit tables: `payment_transactions` deep audit resolved by 4g regen; `credit_events`, `negative_news`, `sec_filings` — not deeply audited; deferred.

### Phase 2 — Design the four user-facing decisions ✅ DONE

**2a. Input Contract document.** ✅ Now at `docs/INPUT_CONTRACT.md`.

**2b. Customer identifier resolution strategy.** ✅ `customer_identifiers` table created Phase 3; CIK/ticker migrated Phase 4. Lookup-precedence strategy documented in Customer Identifier Strategy doc.

**2c. Currency commitment.** ✅ USD-only V1. Documented in Input Contract and Data Contract.

**2d. Country semantics.** ✅ Address country. `country_code` added Phase 3, backfilled Phase 4.

### Phase 3 — Schema migrations ✅ DONE

**3a. Dropped unused legacy columns** on `invoices` (`amount`, `paid_amount`, `dunning_level`) and `payment_transactions` (`amount`, `paid_on_time` from Phase 3; note: `paid_on_time` still present in live — B5-deferred via view dependency).

**3a-bis. Dropped `flags` column on `customers`.** Deferred to B5 (view dependency).

**3b. Added `country_code` to customers.** ✅

**3c. Created `customer_identifiers` table.** ✅ CIK/ticker migrated in Phase 4.

**3a-ter. Dropped `ar_aging_snapshots.dso_days`.** ✅ Rewrote `v_ar_aging_current` + `v_ar_aging_portfolio`.

**Phase 1d. Dropped `invoices.next_dunning_date`.** ✅ Rewrote `v_overdue_invoices`.

### Phase 4 — Data migrations ✅ DONE

**4a. Invoice data consistency.** ✅ amount_paid, outstanding_amount, days_overdue all reconciled.

**4b. Re-derive `customers.current_exposure`.** ✅ `fn_recalculate_exposure` called for all 59.

**4c. Re-derive `ar_aging_snapshots`.** ✅ `fn_refresh_all_ar_aging` rebuilt all snapshots.

**4d. Populate `country_code`.** ✅ 58 US, 1 DK.

**4d-bis. Backfill `payment_transactions.on_time`.** ✅ (Phase 3 column drop done; 4g regen replaced the data anyway.)

**4e. Migrate identifiers.** ✅ 47 CIK + 47 ticker rows in `customer_identifiers`.

**4f. Delete stale `negative_news` rows.** ✅ 32 rows deleted.

**4g. Payment_transactions realism.** ✅ Full regen — 472 rows, 8/customer, persona-aligned. 27 healthy / 10 watch / 22 at_risk.

### Phase 5 — Verification ✅ DONE

- CIA harness 8/8 (one re-run needed for pre-existing q1 flakiness).
- Payment behaviour verified 59/59 via `tests/payments/verify-payments.mjs` using the real skill.
- Invoice consistency: dry-run verified 0 mismatches before committing.
- Snapshot totals: reconciled to $80,140,000 total exposure.

### Phase 6 — Documentation ✅ DONE

**6a. `docs/DEMO_DATA_CONTRACT.md`** ✅

**6b. `docs/INPUT_CONTRACT.md`** ✅

**6c. Updated backlog** ✅ — F1–F5 logged; D0b and D0c resolved; B-prime absorbed.

---

## Scope discipline

What B0 did NOT do:

- **No agent code changes** (other than the News and AR agent refactors that were prerequisites for the data-pipeline work).
- **No taxonomy changes** (that was B4).
- **No ranking logic encoding** (that's B5 — happens after B0).
- **No frontend changes** (separate concern).
- **No replacement of personas** — kept the 59 customers, fixed their data.
- **No multi-currency support** — V1 stays USD.
- **No fancy onboarding workflow** — the Input Contract is documentation; actual onboarding workflow improvements are post-audit work.
