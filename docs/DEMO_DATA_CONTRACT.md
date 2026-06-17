# CreditPilot — Demo Data Contract (V1)

**Status:** Locked design.
**Decision date:** 2026-06-02
**Last updated:** 2026-06-06 (B0 completion pass — added sec_monitoring, bankruptcy_details, growth_signals; reflected B0 column drops and data fixes)
**Scope:** The single reference for what each field in CreditPilot's data model means, who is responsible for keeping it correct, and what values are valid. This is the durable answer to "what does this column actually represent?"

---

## How to use this doc

For every important field in every table, this doc records:

- **Meaning:** precise definition of what the field represents.
- **Provenance:** who writes it (seed / trigger / agent / user upload), how it's maintained.
- **Valid values:** what's allowed, what's rejected.
- **Cross-references:** where it appears, who reads it.

When in doubt about a field, consult this doc. When data drift is found, this doc is the truth — the data is wrong, not the contract.

For input-side contracts (CSV uploads, etc.), see `docs/INPUT_CONTRACT.md`.
For identifier resolution rules, see the Customer Identifier Strategy doc.

---

## Cross-cutting design decisions

These apply across all tables:

### Currency: USD-only in V1
All monetary fields are interpreted as US dollars. No currency conversion. The `currency` column on `invoices` defaults to 'USD' and any non-USD value is rejected at upload. Multi-currency support is V2 (backlog D1d) and must be done thoroughly across all tables when added, not partially.

### Country: address-country
Country on customers = the country of the customer's company address. ISO 3166-1 alpha-2 codes. NOT NULL (default 'US' if truly unknown). This is the verifiable anchor — backed by postal/registry records. Risk-country, operating-country, and other interpretations are derived if needed, not stored.

### Computed metrics belong at the database layer
Metrics derived from other fields (utilization_pct, dso_days, etc.) should be computed at read time (in views or query expressions), NOT stored as static columns. Stored derived values inevitably drift. Examples of correct pattern: `v_ar_aging_current` computes utilization fresh each time. Examples of past mistakes: `dso_days` stored on snapshots (dropped in B0), `flags` stored on customers (dropped in B5).

### Single source of truth for identifiers
Each external identifier (DUNS, ticker, CIK, LEI) lives in `customer_identifiers`, not denormalized onto the customers table. See Customer Identifier Strategy doc for details. The one exception: `sec_filings.cik` is denormalized for query efficiency (it's stored per-filing alongside the customer relationship). Note: `customers.sec_cik` and `customers.ticker` still exist as convenience fields and are still read by `sec-monitor-agent`; migration to `customer_identifiers` as the sole source is deferred to Phase 4 data migration (B0 backlog).

### Two 0–100 scores, opposite directions (by design)
The system has two distinct 0–100 scores that look alike but mean opposite things — important to keep straight:
- `credit_rating_score` (on customers): **lower = worse.** Measures customer creditworthiness; 0 is worst credit, 100 is best. User-facing.
- `severity_score` (on credit_events): **higher = worse.** Measures event severity; 0 is least severe, 100 is most. Internal ranking input (summed in `fn_rank_portfolio_risk`), never shown to users as a raw number — users see the `severity` label (critical/high/medium/low).

These are not inconsistent — they measure different things (how *good* a customer's credit is vs. how *bad* an event is). severity_score is deliberately NOT flipped to match credit_rating_score: doing so would make it inconsistent with its own severity label and require rework across publishEvent, the B5 ranking, and every agent. Current event convention: critical=92, high=75 (medium=55, low=30 introduced by OVERDUE_AR).

---

## Table: customers

The master customer record. Slow-changing. One row per company we monitor. 59 rows in demo.

| Field                       | Meaning | Provenance | Notes |
|-----------------------------|---------|-----------|-------|
| `id`                        | UUID primary key | Generated | — |
| `company_name`              | Legal/common name of the company | Manual entry | Free-form text |
| `sector`                    | Industry sector | Manual entry | CHECK-constrained to: Aerospace & Defense, Energy, Industrial Manufacturing, Materials, Transportation, Mining, Other |
| `industry`                  | Sub-industry / finer breakdown | Manual entry | Free-form text |
| `country_code`              | ISO 3166-1 alpha-2, country of the company's address | Manual entry at customer creation | NOT NULL DEFAULT 'US'. Added B0 Phase 3. 58 US / 1 DK (Liqtech). |
| `scenario`                  | Demo scenario tag (drives the demo narrative) | Seed | Enum: normal_operations, payment_issues, credit_deterioration, negative_news, growth_opportunity, bankruptcy, sec_filing_monitoring |
| `credit_limit`              | Customer's approved credit limit in USD | Manual entry | bigint, USD |
| `current_exposure`          | Customer's currently-utilized credit in USD | **Trigger-maintained** (`fn_trg_recalculate_exposure`) | bigint, USD. Computed as SUM(invoices.amount_outstanding) WHERE status NOT IN ('paid','written_off'). Read-only from application perspective. Portfolio total: $80,140,000 as of B0 Phase 4. |
| `credit_rating_score`       | Numeric credit score 0–100, lower = worse | Manual entry / future credit-rating agent | CHECK 0–100 |
| `credit_rating_raw`         | Original rating text from source (e.g. "CCC+", "Baa3") | Manual entry / future agent | Free-form |
| `credit_rating_source`      | Where the rating came from | Manual entry / future agent | Free-form (S&P, Moody's, etc.) |
| `credit_rating_previous_score` | The previous score, set when a new rating arrives | Future credit-rating agent | Populates only on rating changes |
| `credit_rating_updated_at`  | When the rating was last set | Manual / agent | timestamptz |
| `risk_tags`                 | Array of active risk signals on this customer | **CIA-written** (per assessment) | Set values include: NEGATIVE_NEWS, GOING_CONCERN, HIGH_UTILIZATION, MULTI_SIGNAL_RISK, SEC_ALERT, BANKRUPTCY. CIA assesses subsets of customers per run; field accumulates over time. |
| `risk_tags_updated_at`      | When CIA last updated risk_tags for this customer | CIA-written | timestamptz |
| `payment_on_time_rate`      | 0.0–1.0, fraction of payments made on time | **AR-written** (via analyse-payment-behaviour skill) | Refreshed by AR agent runs |
| `payment_avg_days_early_late` | Average days early (negative) or late (positive) | AR-written | numeric |
| `payment_trend`             | Trend of payment behaviour | AR-written | CHECK: improving, stable, deteriorating, insufficient_data |
| `payment_health`            | Overall payment health classification | AR-written | CHECK: healthy, watch, at_risk, unknown. B0 Phase 4g backfilled all 59 customers: 27 healthy / 10 watch / 22 at_risk. |
| `payment_behaviour_updated_at` | When AR last computed payment behaviour | AR-written | timestamptz |
| `headquarters`              | Free-form HQ location (e.g. "Chicago, IL") | Manual entry | Display only; structured country lives in `country_code` |
| `ticker`                    | Stock ticker (convenience denorm) | Manual | Still read by sec-monitor-agent. Canonical location: `customer_identifiers`. Drop deferred to B0 Phase 4 migration completion. |
| `sec_cik`                   | SEC CIK (convenience denorm) | Manual | Still read by sec-monitor-agent. Canonical location: `customer_identifiers`. Drop deferred to B0 Phase 4 migration completion. |
| `flags`                     | **DROPPED in B5** (migration 20260607230000) | (no readers) | Pre-V1-taxonomy cruft; 38 distinct values, no agent read it. Was blocked by v_customers_at_risk + v_portfolio_overview, which were rewritten to the V1 ranking rule in the same migration. |
| `account_manager`           | Name/email of account owner | Manual | Free-form |
| `customer_since`            | When the relationship started | Manual | date |
| `payment_terms_days`        | Standard payment terms (e.g. 30, 45, 60) | Manual | integer, default 45 |

---

## Table: invoices

Per-invoice records. 160 rows in demo. Source of truth for AR exposure.

| Field                       | Meaning | Provenance | Notes |
|-----------------------------|---------|-----------|-------|
| `id`                        | UUID PK | Generated | — |
| `customer_id`               | FK to customers | — | ON DELETE CASCADE |
| `invoice_number`            | Customer-system invoice ID | Upload | Required, unique per customer |
| `invoice_date`              | Date invoice issued | Upload | Required |
| `due_date`                  | Date payment due | Upload | Required, must be >= invoice_date |
| `invoice_amount`            | Original invoice gross amount in USD | Upload | bigint, required. The canonical "original amount" field. |
| `amount_paid`               | Amount paid against this invoice in USD | Computed via payment activity / upload | bigint. B0 Phase 4a: set to invoice_amount for paid invoices, 0 for all others. |
| `amount_outstanding`        | Unpaid balance | **Generated column** | bigint, `GENERATED ALWAYS AS (invoice_amount - amount_paid) STORED`. Used by exposure trigger. |
| `outstanding_amount`        | Unpaid balance as reported in upload | Upload | numeric. The CSV upload path writes this directly. Read by CIA when answering invoice questions. B0 Phase 4a: reconciled to agree with `amount_outstanding`. |
| `status`                    | Invoice lifecycle status | Upload / derived | Enum: current, overdue, paid, pre_petition, disputed, written_off. Note: legacy 'open' status reclassified to 'current' in B0 Phase 4. |
| `days_overdue`              | Days past due_date | Computed at upload time | integer; set to 0 for pre_petition invoices (B0 Phase 4a workaround for F1 bucket double-count). See backlog F2 (demo aging is frozen). |
| `dunning_stage`             | Current dunning stage | Manual / agent | Enum: 1, 2, 3, 4, null |
| `escalated_to_collections`  | Whether sent to collections | Manual | boolean |
| `claimable`                 | Whether this invoice is claimable in bankruptcy proceedings | Seed | boolean. True for the 10 pre_petition invoices; false for all others. Read by `v_bankruptcy_claims` to compute `claimable_invoice_count` and `claimable_total` for each bankrupt customer. No current agent writes or reads this directly. |
| `currency`                  | Currency code | Upload | Default 'USD'. V1: enforced USD-only at upload. |

---

## Table: customer_identifiers

External identifiers (DUNS, ticker, CIK, LEI, internal_customer_code) for customer lookup. Single source of truth for external identifiers. 47 CIK rows + 47 ticker rows migrated from customers in B0 Phase 4.

| Field         | Meaning | Notes |
|---------------|---------|-------|
| `customer_id` | FK to customers | ON DELETE CASCADE |
| `id_type`     | Type of identifier | CHECK: duns, ticker, cik, lei, internal_customer_code |
| `id_value`    | The identifier value | text, NOT NULL. Globally unique within (id_type, id_value). |
| `is_primary`  | Mark as primary identifier for that type for this customer | boolean. Unique on (customer_id, id_type) where is_primary = true. |
| `source`      | Provenance of the identifier | CHECK: manual, edgar_verified, customer_supplied, duns_lookup |
| `verified_at` | When external verification confirmed | nullable timestamptz |

---

## Table: ar_aging_snapshots

Aggregated AR state per customer at a point in time. Read primarily via `v_ar_aging_current` (latest per customer).

| Field                  | Meaning | Provenance | Notes |
|------------------------|---------|-----------|-------|
| `id`                   | UUID PK | Generated | — |
| `customer_id`          | FK | — | — |
| `snapshot_date`        | Date of this snapshot | — | The view picks latest per customer |
| `current_amount`       | $ in current (not yet due) bucket | Computed from invoices | bigint, USD |
| `bucket_1_30`          | $ in 1–30 days past due | Computed | bigint |
| `bucket_31_60`         | $ in 31–60 days past due | Computed | bigint |
| `bucket_61_90`         | $ in 61–90 days past due | Computed | bigint |
| `bucket_over_90`       | $ over 90 days past due | Computed | bigint. Used by V1 ranking as bankruptcy/distress signal. |
| `pre_petition_amount`  | $ in pre-petition status (pre-bankruptcy AR) | Computed | bigint. Used by V1 ranking as a bankruptcy trigger. |
| `total_outstanding`    | Sum of current + aging buckets | Computed | bigint. Generated column: current_amount + the four aging buckets. **Deliberately excludes pre_petition_amount** — represents outstanding AR in the normal aging sense; pre-petition AR (bankruptcy estate, impaired collectability) is tracked separately in pre_petition_amount. Consequence: portfolio total_outstanding (77,897,000 via v_ar_aging_portfolio) is less than total current_exposure (80,140,000) by exactly the pre_petition sum (2,243,000). Use current_exposure for the all-in owed figure; total_outstanding is the collectable-aging view. (Backlog F4 — closed as by-design.) |
| `utilization_pct`      | total_outstanding / credit_limit, 0–100+ | Stored | numeric. Computed fresh in `v_ar_aging_current` via LATERAL join (B0 Phase 3a-ter). The stored value is the snapshot's computed value at generation time; the view always derives it fresh. |
| `credit_limit`         | Credit limit at snapshot time | Denormalized from customers at snapshot time | Drift risk — `v_ar_aging_current` joins to customers.credit_limit directly for live utilization_pct. |

**Note on `dso_days`:** dropped in B0 Phase 3a-ter (no readers; compute at read time if ever needed).

---

## Table: payment_transactions

Per-payment records. 472 rows in demo (8 per customer, 59 customers). Source for the analyse-payment-behaviour skill.

| Field             | Meaning | Provenance | Notes |
|-------------------|---------|-----------|-------|
| `id`              | UUID PK | Generated | — |
| `customer_id`     | FK | — | — |
| `invoice_id`      | FK to invoices | — | ON DELETE SET NULL |
| `payment_date`    | When payment received | — | date |
| `amount_paid`     | $ paid | — | bigint, USD |
| `days_early_late` | Negative = early, positive = late | Computed from invoice due_date | integer |
| `on_time`         | Whether payment was on or before due date | Computed `(days_early_late <= 0)` | boolean. Fully populated as of B0 Phase 4g (was null for 91% of rows prior). |
| `payment_method`  | How payment was made | — | Enum |
| `is_partial_payment` | Whether this is partial | — | boolean |
| `paid_on_time`    | **DROPPED in B5** (migration 20260607230000) | (no readers) | Was a boolean duplicate of `on_time`. v_customers_at_risk + v_payment_behaviour were rewritten to use `on_time` in the same migration. |

**On-time definition (V1):** strict. `on_time = (days_early_late <= 0)`. Paid on or before due date = on time. No grace period.

**Demo distribution (B0 Phase 4g):** 27 healthy / 10 watch / 22 at_risk customers. Transactions are persona-aligned with realistic spread — healthy customers pay 5–8 days early, watch customers pay 2–14 days late with some on-time, at_risk customers show worsening lateness trends.

---

## Table: sec_monitoring

Configuration table for the SEC Monitor agent — one row per customer being monitored for SEC filings. 3 rows in demo.

**Schema note (F5):** 6 columns exist in the live database but are absent from all committed migrations (`monitoring_active`, `filing_types_monitored`, `last_8k_date`, `risk_signals_detected`, `next_scheduled_review`, `updated_at`). Additionally, `risk_signals` (in base migration) and `ai_risk_score`/`ai_summary` (added by migration `20260310125929`) do not exist in the live schema — they appear to have been dropped or renamed outside migration control. A catch-up migration is needed before the next DB reset (backlog F5).

| Field                    | Meaning | Provenance | Notes |
|--------------------------|---------|-----------|-------|
| `id`                     | UUID PK | Generated | — |
| `customer_id`            | FK to customers | Seed / manual | — |
| `cik`                    | SEC CIK for this customer | Seed / manual | Used by sec-monitor-agent to query EDGAR. Should match `customer_identifiers` once B0 Phase 4 migration is complete. |
| `monitoring_active`      | Whether SEC monitoring is enabled for this customer | Seed | boolean DEFAULT true. Unmigrated column (F5). |
| `filing_types_monitored` | Which filing types to check | Seed | text[] DEFAULT ARRAY['10-K','10-Q','8-K']. Unmigrated column (F5). |
| `last_10k_date`          | Date of most recent 10-K detected | sec-monitor-agent | date, nullable |
| `last_10q_date`          | Date of most recent 10-Q detected | sec-monitor-agent | date, nullable |
| `last_8k_date`           | Date of most recent 8-K detected | sec-monitor-agent | date, nullable. Unmigrated column (F5). |
| `risk_signals_detected`  | Array of risk signal tags found in latest filing analysis | sec-monitor-agent | text[] DEFAULT '{}'. Read and written by agent. Unmigrated column (F5). |
| `alert_triggered`        | Whether an alert has been raised for this customer | sec-monitor-agent | boolean DEFAULT false |
| `alert_date`             | Date the alert was triggered | sec-monitor-agent | date, nullable |
| `alert_action_taken`     | Free-form note on what was done about the alert | Manual / sec-monitor-agent | text, nullable |
| `next_scheduled_review`  | Date of next scheduled review | Seed / manual | date, nullable. Unmigrated column (F5). |
| `last_checked_at`        | When sec-monitor-agent last ran against this row | sec-monitor-agent | timestamptz, nullable |
| `created_at`             | Row creation timestamp | Generated | timestamptz |
| `updated_at`             | Last update timestamp | DB trigger / manual | timestamptz. Unmigrated column (F5). |
| `is_demo`                | Demo or production data | Seed / agent | boolean NOT NULL DEFAULT false |

---

## Table: bankruptcy_details

Detailed bankruptcy tracking for customers in chapter 11/7 proceedings. 4 rows in demo.

**Provenance:** seed data only — no agent currently writes to this table. Read by the frontend via `v_bankruptcy_claims`. The `agent_name` column is absent from this table (all 4 rows were seeded manually with no agent attribution).

| Field                         | Meaning | Notes |
|-------------------------------|---------|-------|
| `id`                          | UUID PK | — |
| `customer_id`                 | FK to customers | ON DELETE CASCADE |
| `filing_date`                 | Date of bankruptcy filing | date, NOT NULL |
| `case_number`                 | Court case number | text, NOT NULL |
| `court`                       | Bankruptcy court name | text, nullable |
| `chapter`                     | Chapter number (7 or 11) | integer, NOT NULL |
| `status`                      | Current bankruptcy status | `bankruptcy_status` enum, DEFAULT 'FILED'. Values include: FILED, REORGANIZING, EMERGED, LIQUIDATING, DISMISSED |
| `plan_confirmation_date`      | Date reorganization plan was confirmed | date, nullable |
| `emergence_date_estimated`    | Estimated emergence date (free-form text) | text, nullable |
| `chapter7_conversion_date`    | Date of conversion to Chapter 7 | date, nullable |
| `asset_sale_date`             | Date assets were sold (liquidation) | date, nullable |
| `asset_buyer`                 | Buyer in asset sale | text, nullable |
| `trustee`                     | Appointed bankruptcy trustee | text, nullable |
| `reorganization_advisor`      | Restructuring advisor | text, nullable |
| `legal_counsel`               | Legal counsel firm | text, nullable |
| `proof_of_claim_filed`        | Whether we have filed a proof of claim | boolean DEFAULT false |
| `proof_of_claim_date`         | Date proof of claim was filed | date, nullable |
| `proof_of_claim_amount`       | Amount claimed | bigint, USD, nullable |
| `estimated_recovery_rate`     | Estimated recovery rate (0.0–1.0) | numeric, nullable |
| `estimated_recovery_amount`   | Dollar amount estimated to recover | bigint, USD, nullable |
| `total_pre_petition_claim`    | Total pre-petition AR claim | bigint, USD, nullable |
| `notes`                       | Free-form notes | text, nullable |
| `created_at`                  | Row creation timestamp | timestamptz |
| `updated_at`                  | Last update timestamp | timestamptz |

**View `v_bankruptcy_claims`:** joins to `customers` and to `invoices` (via `invoices.claimable = true`) to surface `claimable_invoice_count` and `claimable_total` alongside the bankruptcy details. Read by the frontend's bankruptcy tracking UI.

---

## Table: growth_signals

Growth opportunity tracking for customers showing positive momentum. 5 rows in demo.

**Provenance:** seed data only — no agent currently writes to this table (`agent_name` is NULL for all 5 rows). Read by the frontend via `v_growth_opportunities`.

| Field                           | Meaning | Notes |
|---------------------------------|---------|-------|
| `id`                            | UUID PK | — |
| `customer_id`                   | FK to customers | ON DELETE CASCADE |
| `growth_trajectory`             | Qualitative growth description | text, nullable (e.g. "Strong", "Accelerating") |
| `revenue_growth_yoy`            | Year-over-year revenue growth rate | numeric, nullable |
| `backlog_amount`                | Value of customer's order backlog | bigint, USD, nullable |
| `backlog_description`           | Description of backlog/pipeline | text, nullable |
| `recent_milestones`             | Array of recent positive milestones | text[] DEFAULT '{}' |
| `credit_limit_increase_recommended` | Whether a credit limit increase is recommended | boolean DEFAULT false |
| `recommended_new_limit`         | Proposed new credit limit | bigint, USD, nullable |
| `rationale`                     | Reasoning for the recommendation | text, nullable |
| `upsell_opportunity`            | Description of upsell/cross-sell opportunity | text, nullable |
| `agent_name`                    | Agent that wrote this row | text, nullable. Currently NULL for all rows (seed data). Field exists for future agent writer. |
| `created_at`                    | Row creation timestamp | timestamptz |
| `updated_at`                    | Last update timestamp | timestamptz |

**View `v_growth_opportunities`:** joins to `customers` and filters to `credit_limit_increase_recommended = true`. Returns credit_limit, current_exposure, account_manager, and the growth signal fields. Read by the frontend's growth opportunities UI.

---

## Table: credit_events

The signal layer. Every detected event lives here. V1 taxonomy defines 29 event types.

Required fields for every event (validated by publishEvent):
- `event_type` (one of the V1 enum values)
- `source_agent`
- `severity` (critical / high / medium / low / info)
- `severity_score` (0–100)
- `title`
- `summary` (required for severity >= medium)
- `payload` (jsonb, validated against type-specific Zod schema)
- `is_demo` (boolean)
- `customer_id` (for customer-scoped events)

See `docs/EVENT_TAXONOMY.md` and `supabase/functions/_shared/event_schemas.ts` for per-event-type payload contracts.

---

## Table: negative_news

News items detected by news_monitor_agent. Working table; CIA reads for "negative news" question types.

| Field                 | Meaning | Provenance | Notes |
|-----------------------|---------|-----------|-------|
| `customer_id`         | FK | — | — |
| `news_date`           | Date of the article | News pipeline | date |
| `headline`            | Article title | News pipeline | text |
| `url`                 | Source URL | News pipeline | nullable (seed data may not have URL) |
| `source`              | Publication name (Reuters, Bloomberg, etc.) | News pipeline | free-form text |
| `provider`            | Fetch mechanism | News pipeline | manual / tavily / google_news |
| `sentiment_score`     | –1.0 to 1.0 | News pipeline | numeric(4,2) |
| `category`            | Subcategory (earnings_miss, layoffs, lawsuit, etc.) | News pipeline | free-form text |
| `severity`            | Classification | News pipeline | CHECK: critical / high / medium / low |
| `content_fingerprint` | Hash for dedup | News pipeline | text; PARTIAL UNIQUE INDEX on non-null values |
| `is_demo`             | Demo or production data | News pipeline | boolean |
| `reviewed` / `reviewed_by` / `reviewed_at` / `action_taken` | **Deprecated** workflow columns | (no readers) | Pre-V1 hand-review workflow, never implemented. |

---

## Table: sec_filings

SEC filings detected by sec_monitor_agent. Working table.

| Field              | Meaning | Provenance | Notes |
|--------------------|---------|-----------|-------|
| `customer_id`      | FK | — | — |
| `filing_date`      | Filing date | EDGAR / seed | date |
| `filing_type`      | Form type | EDGAR / seed | text (10-K, 10-Q, 8-K) |
| `accession_number` | SEC unique ID | EDGAR | text, UNIQUE per customer where present |
| `cik`              | SEC CIK (denormalized for query) | EDGAR / seed | text. Intentional denormalization for filing-side efficiency. |
| `url` / `document_url` | Filing URLs | EDGAR / seed | text |
| `key_findings`     | Free-form extracted findings | Agent | text |
| `risk_signals`     | Tags extracted from filing | Agent | text[] |
| `provider`         | Source of data | — | default 'edgar' |
| `is_demo`          | Demo or production data | Agent | boolean |
| `reviewed*`        | **Deprecated** workflow columns | (no readers) | Same pattern as negative_news |

---

## Seed data overview

| Table | Rows | Description |
|-------|------|-------------|
| `customers` | 59 | Specialty alloys distributor customers across 7 credit scenarios |
| `invoices` | 160 | 150 active invoices + 10 pre_petition; portfolio exposure $80.14M |
| `ar_aging_snapshots` | 59 | One latest snapshot per customer, rebuilt B0 Phase 4 |
| `payment_transactions` | 472 | 8 per customer, persona-aligned, B0 Phase 4g. 27 healthy / 10 watch / 22 at_risk |
| `sec_monitoring` | 3 | Triumph Group, Boeing, Spirit Airlines |
| `sec_filings` | varies | Pipeline-generated; deduplicated by accession_number |
| `bankruptcy_details` | 4 | Spirit, Rite Aid, Proterra, Yellow |
| `growth_signals` | 5 | Customers with credit_limit_increase_recommended = true |
| `negative_news` | 5 | Pipeline-generated (2026-05-25 batch via seed_news); 32 pre-pipeline stale rows deleted B0 Phase 4 |
| `credit_events` | varies | Pipeline-generated by agents |
| `customer_identifiers` | 94 | 47 CIK + 47 ticker rows migrated from customers in B0 Phase 4 |

---

## What this doc explicitly does NOT cover

- **Auth / tenancy tables.** Out of scope; CreditPilot is single-tenant V1.
- **Agent operational tables** (`agent_runs`, `agent_messages`, etc.). Internal plumbing; document once stable.
- **Frontend conventions.** Separate.
- **Detailed per-event payload contracts.** See `event_schemas.ts` and `docs/EVENT_TAXONOMY.md`.

---

## TODOs for the next doc pass

- **`docs/DEMO_MODE.md` is stale** — still describes 49 customers, pre-V1 demo mode behaviour. Update in a separate pass (out of B0 scope).

---

## Maintenance

This doc is updated whenever a field is added, renamed, dropped, or its semantics change. Schema migrations should reference the doc in their commit messages. New tables added during V1 evolution get a new section here.

When the data and the doc disagree, the doc wins — fix the data.
