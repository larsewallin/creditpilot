# CreditPilot Event Taxonomy

**Version:** v1 (locked for implementation, revised 2026-05-14)
**Status:** Design complete — ready to implement
**Last updated:** 2026-05-14 (post-implementation discovery: news + SEC restructured to handle open-ended sources)

This document defines the contract that every CreditPilot agent must follow when emitting or consuming events. It is the single source of truth for what events exist, what they carry, who produces them, and who consumes them.

---

## Why this exists

CreditPilot's agents communicate by writing to the `credit_events` table. Without a contract, every new agent reinvents what an event looks like, and the system fragments. This taxonomy is that contract.

---

## Conventions

### Event type naming

Format: `SUBJECT_NOUN` in screaming snake case. Severity is **never** part of the event type name — it lives in the dedicated `severity` column.

Good: `COVENANT_WAIVER`, `UTILIZATION_THRESHOLD_BREACH`, `COUNTRY_RATING_CHANGE`, `RISK_CHANGE`
Bad: `NEGATIVE_NEWS_HIGH` (severity in name), `BAD_NEWS` (not specific), `negative_news` (wrong case)

### Severity scale

Five qualitative tiers in the `severity` column:

- `critical` — immediate action required; customer-threatening
- `high` — material change; escalate within 24 hours
- `medium` — notable change; review at next cycle
- `low` — informational; track but no action
- `info` — observational; not a risk signal

Plus a numeric `severity_score` (0–100) carried in the payload for aggregation. The qualitative value is for humans and UI; the numeric is for math (composite risk scoring, weighted alerts).

Mapping:

| qualitative | numeric range |
|-------------|---------------|
| critical    | 85–100 |
| high        | 65–84  |
| medium      | 40–64  |
| low         | 15–39  |
| info        | 0–14   |

**The `publishEvent()` helper keeps these in sync automatically.** Producers can set whichever feels natural; the helper derives the other and rejects events where both are set inconsistently.

### Scope

Every event has a `scope` field indicating what it applies to:

- `customer` — applies to one customer; `customer_id` is set
- `country` — applies to a country; `customer_id` is null; payload includes ISO country code
- `industry` — applies to an industry/sector; `customer_id` is null; payload includes sector name
- `currency` — applies to a currency; `customer_id` is null; payload includes ISO currency code
- `portfolio` — applies to the user's whole portfolio; `customer_id` is null

### Required event fields

Every event in `credit_events` has:

| field | type | required | purpose |
|-------|------|----------|---------|
| `id` | uuid | yes | unique identifier |
| `event_type` | enum | yes | what kind of event |
| `severity` | enum (critical/high/medium/low/info) | yes | qualitative severity |
| `scope` | enum (customer/country/industry/currency/portfolio) | yes | what this event applies to |
| `customer_id` | uuid | conditional | required if scope=customer; null otherwise |
| `source_agent` | string | yes | which agent produced this |
| `correlation_id` | uuid | yes | groups events in a cascade |
| `parent_event_id` | uuid | nullable | immediate parent event id — the event that triggered this one (null for root events) |
| `title` | string | yes | one-line human-readable summary |
| `description` | text | yes | longer prose description |
| `summary` | text | conditional | AI-generated summary; required for severity ≥ medium, optional otherwise |
| `payload` | jsonb | yes | event-type-specific structured data |
| `created_at` | timestamp | yes | when the event was produced |
| `is_demo` | boolean | yes | demo data flag |

### Summary field

For events with severity `medium`, `high`, or `critical`, the producer generates an AI summary at emit time (small Haiku call) and stores it on the event. For severity `low` and `info`, the summary is templated from payload fields without an LLM call. This balances cost against the value of having pre-generated summaries available for fast briefing and audit reads.

### Cascade tracking: correlation_id and parent_event_id

Cascade integrity is built on two fields:
- `correlation_id` — the *root* event's id, copied to every downstream event in the cascade. Lets you query "show me everything that resulted from the Brazil downgrade."
- `parent_event_id` — the *immediate* parent event id. Lets you reconstruct the causal tree. (This column predates the V1 taxonomy and serves as the "triggered_by" concept; we kept the existing name rather than adding a redundant column.)

The root event (the one that started the cascade) has `correlation_id = its own id` and `parent_event_id = null`. The `publishEvent()` helper handles this automatically.

### Idempotency

When an agent processes an event, it records that fact in `agent_processed_events` (`agent_name` + `event_id`). Consumers must check this table before processing and skip events already handled. This prevents reruns from double-counting after a crash or restart.

### Versioning

Each event type has a `taxonomy_version` (currently `1` for everything in this document). When a payload shape changes incompatibly, the version increments and downstream consumers must update before subscribing to v2.

### Corroboration across sources

When two producers detect the same fact (e.g. Bloomberg and Reuters both report the same earnings miss), they emit **separate events with shared `correlation_id`**. The producer never tries to detect or deduplicate cross-source corroboration — that's the synthesizer's job. The Risk Agent treats multiple corroborating events on the same customer within a short window as a stronger signal than a single event.

---

## Event type catalog

### Customer-specific events

#### `NEWS_EVENT`
News article about a customer. Single event type covers all news regardless of sentiment or topic — the article's nature lives in the payload via `sentiment` and `subcategory`. This shape handles the open-ended nature of news (no fixed taxonomy of news categories) and lets new subcategories be added without changing the event taxonomy.

- **Producer:** News Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** info to critical (driven by sentiment + subcategory + impact)
- **Payload:**
  - `severity_score`: 0–100
  - `sentiment`: 'negative' | 'positive' | 'neutral'
  - `sentiment_score`: -1.0 to 1.0
  - `subcategory`: string — a free-form descriptor of the news topic (e.g. `earnings_miss`, `earnings_beat`, `leadership_change`, `layoffs`, `product_recall`, `lawsuit`, `regulatory_probe`, `acquisition`, `partnership`, `factory_incident`). New subcategories may be added over time without changing the taxonomy.
  - `article_title`: string
  - `article_url`: string or null — nullable; a missing URL must never drop a real event
  - `published_at`: ISO datetime
  - `source`: string — free-form publication name (e.g. "Reuters", "Seeking Alpha"). Not an enum: publications are open-ended.
  - `provider`: enum (`tavily` | `google_news` | `manual`) — the fetch mechanism, distinct from the publication.
  - `key_phrases`: string[] — may be empty if the source doesn't supply phrases
  - `summary`: string (AI-generated, 2–3 sentences)
  - **No full article body** — URL is preserved for original-source access

#### SEC events — design

The SEC Monitor reads 10-K, 10-Q, and 8-K filings and emits events based on *what it finds in them*, not the filing type itself. The filing type goes in the payload (`filing_source_type`) as context for the audit trail. The events themselves are typed on the concern found:

- `COVENANT_WAIVER`, `CEO_DEPARTURE`, `REVENUE_MISS`, `GOING_CONCERN` — typed events for the common, well-defined concerns
- `SEC_OTHER` — catch-all for noteworthy items that don't fit the above (e.g. material litigation, restatements, auditor changes, debt issuances, subsidiary sales, regulatory probes). Each `SEC_OTHER` event carries a `concern_category` in the payload so consumers can disambiguate; common categories may be promoted to their own event types as patterns emerge.

This hybrid (typed for common cases, generic catch-all for the long tail) keeps the taxonomy clean while remaining open to the variety of things filings contain.

#### `COVENANT_WAIVER`
SEC filing or news reports a covenant waiver was granted.

- **Producer:** SEC Monitor (primary), News Monitor (secondary corroboration)
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** typically high
- **Payload:**
  - `severity_score`: 0–100
  - `filing_source_type`: '10-K' | '10-Q' | '8-K' | 'other' (context — which filing surfaced this; null if from News Monitor)
  - `waiver_date`: ISO date
  - `waived_covenant`: string description
  - `evidence_url`: string
  - `summary`: string

#### `CEO_DEPARTURE`
Customer CEO has departed.

- **Producer:** SEC Monitor (8-K detection), News Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `filing_source_type`: '10-K' | '10-Q' | '8-K' | 'other' (null if from News Monitor)
  - `executive_name`: string
  - `departure_type`: 'resigned' | 'terminated' | 'retired' | 'other'
  - `departure_date`: ISO date
  - `evidence_url`: string
  - `summary`: string

#### `REVENUE_MISS`
Customer reported revenue materially below guidance.

- **Producer:** SEC Monitor, News Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `filing_source_type`: '10-K' | '10-Q' | '8-K' | 'other' (null if from News Monitor)
  - `reported_revenue_usd`: number
  - `expected_revenue_usd`: number
  - `miss_percent`: number
  - `period`: string (e.g. 'Q1 2026')
  - `summary`: string

#### `GOING_CONCERN`
Auditor or SEC filing flagged going-concern doubt.

- **Producer:** SEC Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** typically critical
- **Payload:**
  - `severity_score`: 0–100
  - `filing_source_type`: '10-K' | '10-Q' | '8-K' | 'other'
  - `evidence_url`: string
  - `summary`: string

#### `SEC_OTHER`
Catch-all for noteworthy SEC filing content that doesn't fit the typed event categories above. Each event carries a `concern_category` in the payload so consumers can disambiguate. As patterns emerge (e.g. frequent restatements), common categories may be promoted to their own typed event types in a later taxonomy version.

- **Producer:** SEC Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** low to critical (driven by concern_category)
- **Payload:**
  - `severity_score`: 0–100
  - `filing_source_type`: '10-K' | '10-Q' | '8-K' | 'other'
  - `concern_category`: string — free-form descriptor (e.g. `material_litigation`, `restatement_of_earnings`, `auditor_change`, `debt_issuance`, `subsidiary_sale`, `material_contract`, `regulatory_probe`, `risk_factor_change`). New categories may be added without changing the taxonomy.
  - `evidence_url`: string
  - `summary`: string

#### `OVERDUE_INVOICE`
Invoice has crossed an aging threshold (30, 60, 90+ days past due).

- **Producer:** AR Aging Monitor
- **Consumers:** Risk Agent, Payment Behaviour Monitor, CIA
- **Scope:** customer
- **Severity:** low (30d), medium (60d), high (90d+)
- **Payload:**
  - `severity_score`: 0–100
  - `invoice_id`: uuid
  - `invoice_amount_usd`: number
  - `due_date`: ISO date
  - `days_past_due`: integer
  - `is_disputed`: boolean

#### `UTILIZATION_THRESHOLD_BREACH`
Customer's credit utilization crossed an attention threshold. Single event type covers approaching the limit (medium/high) and exceeding it (critical) — distinguished by severity and payload values.

- **Producer:** AR Aging Monitor
- **Consumers:** Risk Agent, Recommendation Agent (when utilization is at critical), CIA
- **Scope:** customer
- **Severity:** medium (80%+), high (90%+), critical (100%+)
- **Payload:**
  - `severity_score`: 0–100
  - `current_exposure_usd`: number
  - `credit_limit_usd`: number
  - `utilization_percent`: number
  - `threshold_crossed`: number
  - `overage_usd`: number (nullable; populated only when utilization > 100%)

#### `PAYMENT_DETERIORATION`
Customer's payment behavior is trending worse.

- **Producer:** Payment Behaviour Monitor
- **Consumers:** Risk Agent, Working Capital Optimizer (when built), CIA
- **Scope:** customer
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `current_avg_days_to_pay`: number
  - `prior_avg_days_to_pay`: number
  - `trend_direction`: 'worsening' | 'sharply_worsening'
  - `observation_window_days`: integer
  - `summary`: string

#### `PAYMENT_IMPROVEMENT`
Customer's payment behavior is trending better.

- **Producer:** Payment Behaviour Monitor
- **Consumers:** Risk Agent, Value & Opportunity Engine (when built), CIA
- **Scope:** customer
- **Severity:** info to low
- **Payload:** same shape as PAYMENT_DETERIORATION with `trend_direction: 'improving' | 'sharply_improving'`

#### `PAYMENT_VOLATILITY`
Customer's payment timing is becoming unpredictable (high variance).

- **Producer:** Payment Behaviour Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** customer
- **Severity:** low to medium
- **Payload:**
  - `severity_score`: 0–100
  - `standard_deviation_days`: number
  - `observation_window_days`: integer

---

### Environment events (enrichment)

#### `COUNTRY_RATING_CHANGE`
A sovereign credit rating for a country has changed.

- **Producer:** Country Risk Monitor
- **Consumers:** Risk Agent, FX Risk Agent, Concentration Risk Monitor, CIA
- **Scope:** country
- **Severity:** medium (one-notch change) to critical (multi-notch downgrade)
- **Payload:**
  - `severity_score`: 0–100
  - `country_code`: ISO 3166-1 alpha-2
  - `country_name`: string
  - `agency`: 'sp' | 'moodys' | 'fitch'
  - `old_rating`: string
  - `new_rating`: string
  - `outlook`: 'positive' | 'stable' | 'negative' | 'watch'
  - `effective_date`: ISO date

#### `COUNTRY_POLITICAL_RISK`
Political risk in a country has increased materially.

- **Producer:** Country Risk Monitor
- **Consumers:** Risk Agent, FX Risk Agent, CIA
- **Scope:** country
- **Severity:** medium to critical
- **Payload:**
  - `severity_score`: 0–100
  - `country_code`: string
  - `risk_type`: 'election' | 'unrest' | 'sanctions' | 'capital_controls' | 'other'
  - `summary`: string
  - `evidence_url`: string

#### `COUNTRY_ECONOMIC_SHOCK`
Material economic event affecting a country.

- **Producer:** Country Risk Monitor
- **Consumers:** Risk Agent, FX Risk Agent, CIA
- **Scope:** country
- **Severity:** medium to critical
- **Payload:**
  - `severity_score`: 0–100
  - `country_code`: string
  - `shock_type`: 'currency_crisis' | 'recession' | 'inflation' | 'banking_crisis' | 'other'
  - `summary`: string
  - `evidence_url`: string

#### `INTEREST_RATE_CHANGE`
A central bank has changed interest rates materially. Country-scoped event (e.g. the Fed in the US, the ECB across the Eurozone, the BoE in the UK).

- **Producer:** Country Risk Monitor
- **Consumers:** Risk Agent, FX Risk Agent, Forecaster, CIA
- **Scope:** country
- **Severity:** low to medium
- **Payload:**
  - `severity_score`: 0–100
  - `country_code`: string
  - `central_bank`: string
  - `old_rate_percent`: number
  - `new_rate_percent`: number
  - `effective_date`: ISO date

#### `INDUSTRY_DOWNTURN`
An industry sector is showing material weakness.

- **Producer:** Industry Risk Monitor
- **Consumers:** Risk Agent, Forecaster, CIA
- **Scope:** industry
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `sector`: enum from `customers.sector` (Aerospace & Defense, Energy, Industrial Manufacturing, Materials, Transportation, Mining, Other)
  - `indicator`: string (e.g. 'aerospace order book index')
  - `change_percent`: number
  - `period_days`: integer
  - `summary`: string

#### `INDUSTRY_DISRUPTION`
Material disruption affecting an industry.

- **Producer:** Industry Risk Monitor
- **Consumers:** Risk Agent, CIA
- **Scope:** industry
- **Severity:** medium to critical
- **Payload:**
  - `severity_score`: 0–100
  - `sector`: enum
  - `disruption_type`: 'supply_chain' | 'regulatory' | 'technology' | 'demand_shock' | 'other'
  - `summary`: string
  - `evidence_url`: string

#### `REGULATORY_CHANGE`
New regulation, rule, or law affecting an industry materially.

- **Producer:** Industry Risk Monitor
- **Consumers:** Risk Agent, Compliance Agent (when built), CIA
- **Scope:** industry (or country if country-specific)
- **Severity:** low to high
- **Payload:**
  - `severity_score`: 0–100
  - `sector`: enum (if applicable)
  - `country_code`: string (if applicable)
  - `regulation_name`: string
  - `effective_date`: ISO date
  - `summary`: string

#### `TARIFF_CHANGE`
A tariff has been imposed, raised, or removed affecting an industry or country.

- **Producer:** Industry Risk Monitor
- **Consumers:** Risk Agent, Forecaster, CIA
- **Scope:** industry or country
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `tariff_change_percent`: number
  - `affected_countries`: string[] (country codes)
  - `affected_sectors`: string[]
  - `effective_date`: ISO date
  - `summary`: string

---

### Synthesized events

#### `RISK_CHANGE`
The Risk Agent has determined a customer's overall risk profile has changed. Single event type covering escalations, downgrades, upgrades, and clearings — distinguished by `change_type` in the payload.

- **Producer:** Risk Agent
- **Consumers:** Recommendation Agent, CIA
- **Scope:** customer
- **Severity:** info (cleared/upgrade) to critical (sustained downgrade)
- **Payload:**
  - `severity_score`: 0–100
  - `change_type`: 'escalation' | 'downgrade' | 'upgrade' | 'cleared'
  - `risk_components`: array of `{type, severity_score, source_event_id}` — events that contributed to this synthesis
  - `prior_risk_score`: number
  - `new_risk_score`: number
  - `reasoning`: string (AI-generated rationale)

#### `CONCENTRATION_THRESHOLD_BREACH`
Portfolio concentration to a single customer, sector, country, or currency has crossed an attention threshold.

- **Producer:** Concentration Risk Monitor
- **Consumers:** Recommendation Agent, Forecaster, CIA
- **Scope:** portfolio
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `dimension`: 'customer' | 'sector' | 'country' | 'currency'
  - `dimension_value`: string
  - `current_exposure_usd`: number
  - `total_book_usd`: number
  - `concentration_percent`: number
  - `threshold_crossed_percent`: number

#### `PORTFOLIO_INSIGHT`
Forecaster has identified a noteworthy pattern or trend across the portfolio.

- **Producer:** Forecaster Agent
- **Consumers:** CIA, Briefing Generator (when extracted)
- **Scope:** portfolio
- **Severity:** info to medium
- **Payload:**
  - `insight_type`: 'concentration_trend' | 'sector_shift' | 'aging_trend' | 'other'
  - `summary`: string
  - `affected_dimension`: string
  - `direction`: 'increasing' | 'decreasing'
  - `magnitude`: number

#### `CONCENTRATION_WARNING`
Forecaster projects portfolio concentration will breach thresholds in the near future.

- **Producer:** Forecaster Agent
- **Consumers:** Recommendation Agent, CIA
- **Scope:** portfolio
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `dimension`: same as CONCENTRATION_THRESHOLD_BREACH
  - `projected_breach_date`: ISO date
  - `current_concentration_percent`: number
  - `projected_concentration_percent`: number
  - `recommendation`: string

#### `EXPANSION_OPPORTUNITY`
Forecaster identifies an area where credit could safely be expanded.

- **Producer:** Forecaster Agent
- **Consumers:** Recommendation Agent, Value & Opportunity Engine (when built), CIA
- **Scope:** portfolio, industry, or country
- **Severity:** info to low
- **Payload:**
  - `dimension`: string
  - `dimension_value`: string
  - `rationale`: string
  - `proposed_expansion_usd`: number (optional)

#### `EMERGING_RISK_SIGNAL`
Horizon Scanner has detected an early-stage emerging risk.

- **Producer:** Horizon Scanner Agent
- **Consumers:** CIA, Briefing Generator
- **Scope:** portfolio, industry, or country
- **Severity:** info to medium
- **Payload:**
  - `theme`: string (e.g. 'aerospace supply chain reshoring')
  - `time_horizon_months`: integer
  - `confidence`: 'low' | 'medium' | 'high'
  - `affected_sectors`: string[]
  - `affected_countries`: string[]
  - `summary`: string

#### `MACRO_TREND_WARNING`
Horizon Scanner flags a developing macro trend.

- **Producer:** Horizon Scanner Agent
- **Consumers:** Forecaster, CIA
- **Scope:** portfolio
- **Severity:** low to medium
- **Payload:** same shape as EMERGING_RISK_SIGNAL

#### `FX_EXPOSURE_FLAG`
FX Risk Agent has flagged portfolio currency exposure that warrants attention.

- **Producer:** FX Risk Agent
- **Consumers:** Recommendation Agent, CIA
- **Scope:** currency
- **Severity:** medium to high
- **Payload:**
  - `severity_score`: 0–100
  - `currency_code`: ISO 4217
  - `total_exposure_usd`: number
  - `customers_affected`: integer
  - `reason`: string

#### `FX_HEDGING_NEEDED`
FX Risk Agent recommends hedging a particular currency exposure.

- **Producer:** FX Risk Agent
- **Consumers:** Recommendation Agent, CIA
- **Scope:** currency
- **Severity:** medium to high
- **Payload:** same as FX_EXPOSURE_FLAG with `recommended_hedge_amount_usd`

#### `CURRENCY_VOLATILITY`
A currency has shown material volatility recently.

- **Producer:** FX Risk Agent
- **Consumers:** Risk Agent, CIA
- **Scope:** currency
- **Severity:** low to medium
- **Payload:**
  - `severity_score`: 0–100
  - `currency_code`: string
  - `volatility_percent`: number
  - `period_days`: integer

---

### Future event types (V2+ — placeholder, no payload schema yet)

These are documented in the catalog but their full payload definitions are deferred to when their producer agents are built:

- `ESG_CONTROVERSY` (ESG Risk Monitor)
- `CARBON_DISCLOSURE_FLAG` (ESG Risk Monitor)
- `SUPPLY_CHAIN_ISSUE` (ESG Risk Monitor)
- `LIQUIDITY_GAP_FORECAST` (Liquidity Orchestrator)
- `DISPUTE_OPENED`, `DISPUTE_RESOLVED`, `EXCEPTION_ESCALATED` (Dispute and Exception Handler)
- `OPPORTUNITY_IDENTIFIED` (Value & Opportunity Engine)
- `CUSTOMER_ONBOARDED`, `RATING_ASSIGNED`, `INITIAL_LIMIT_PROPOSED` (Onboarding Agent)
- `SANCTIONS_HIT`, `EXPORT_CONTROL_FLAG`, `COMPLIANCE_REVIEW_REQUIRED`, `DOCUMENTATION_GAP` (Compliance Agent)
- `CREDIT_RATING_CHANGE`, `FUNDRAISING_ANNOUNCED`, `ACQUISITION_ANNOUNCED`, `BOND_ISSUED`, `HIRING_FREEZE`, `WEB_TRAFFIC_DECLINE` (future monitors for additional customer signals)

When the producer agent is built, the event type's full payload schema is added to this document, the Zod schema is added to `event_schemas.ts`, and the database CHECK constraint is updated. Until then, the event type is reserved-but-unimplemented.

---

## Implementation requirements

### Database constraints

- `event_type` column has a CHECK constraint limiting it to the documented V1 event types (`NEWS_EVENT`, `COVENANT_WAIVER`, `CEO_DEPARTURE`, `REVENUE_MISS`, `GOING_CONCERN`, `SEC_OTHER`, `OVERDUE_INVOICE`, `UTILIZATION_THRESHOLD_BREACH`, `PAYMENT_DETERIORATION`, `PAYMENT_IMPROVEMENT`, `PAYMENT_VOLATILITY`, `COUNTRY_RATING_CHANGE`, `COUNTRY_POLITICAL_RISK`, `COUNTRY_ECONOMIC_SHOCK`, `INTEREST_RATE_CHANGE`, `INDUSTRY_DOWNTURN`, `INDUSTRY_DISRUPTION`, `REGULATORY_CHANGE`, `TARIFF_CHANGE`, `RISK_CHANGE`, `CONCENTRATION_THRESHOLD_BREACH`, `PORTFOLIO_INSIGHT`, `CONCENTRATION_WARNING`, `EXPANSION_OPPORTUNITY`, `EMERGING_RISK_SIGNAL`, `MACRO_TREND_WARNING`, `FX_EXPOSURE_FLAG`, `FX_HEDGING_NEEDED`, `CURRENCY_VOLATILITY`).
- `severity` column has a CHECK constraint limiting it to `critical | high | medium | low | info`.
- `scope` column has a CHECK constraint limiting it to `customer | country | industry | currency | portfolio`.
- `customer_id` is NOT NULL when scope = 'customer', else NULL (enforced by trigger or CHECK constraint with conditional logic).

### Schema validation

A shared TypeScript file at `supabase/functions/_shared/event_schemas.ts` defines Zod schemas for every V1 event type's payload. The schemas form a discriminated union keyed on `event_type`. Producers must validate before insert; the `publishEvent()` helper does this automatically.

### Publish helper

A shared helper `publishEvent(event: NewCreditEvent)` at `supabase/functions/_shared/publishEvent.ts` is the only path through which agents write to `credit_events`. It:

1. Validates the payload against the appropriate Zod schema for the event_type
2. Computes `severity_score` from `severity` if not provided, or vice versa; throws if both are provided and inconsistent
3. Sets `correlation_id = id` if neither correlation_id nor parent_event_id are provided (root event); otherwise validates that correlation_id is provided
4. For severity ≥ medium, requires the `summary` field
5. Fills in `created_at` if not provided
6. Inserts into `credit_events`

### Idempotency table

A new table `agent_processed_events` with `agent_name` (text) and `event_id` (uuid) columns. Composite primary key on both. Consumers check this table before processing and insert into it after processing.

### Migration of existing events

Existing event_type values in the database that don't match the V1 taxonomy require a one-time migration:

- `NEGATIVE_NEWS_HIGH`, `NEGATIVE_NEWS_MEDIUM`, etc. → `event_type: NEWS_EVENT`, payload gains `sentiment: 'negative'` and `severity` derived from the suffix
- `POSITIVE_NEWS` (if any) → `event_type: NEWS_EVENT`, payload gains `sentiment: 'positive'`
- `CRITICAL_UTILIZATION` → `event_type: UTILIZATION_THRESHOLD_BREACH`, `severity: critical`
- `HIGH_UTILIZATION` → `event_type: UTILIZATION_THRESHOLD_BREACH`, `severity: high`
- `LIMIT_BREACH` (if any) → `event_type: UTILIZATION_THRESHOLD_BREACH`, `severity: critical`
- `GOING_CONCERN_WARNING` → `event_type: GOING_CONCERN`
- `SEC_ALERT` → `event_type: SEC_OTHER`, payload gains `concern_category: 'legacy'` (or reclassified into a typed SEC event if the row clearly fits one)
- `MULTI_SIGNAL_RISK` (if used as event_type) → `event_type: RISK_CHANGE`, payload includes `change_type: 'escalation'`

Other existing event types are mapped explicitly per row in the migration. This migration runs as part of the implementation rollout, after publishEvent is in place but before the CHECK constraint is added.

### Archival policy

Events older than 24 months are moved from `credit_events` to a separate `credit_events_archive` table by a periodic job. The archive table has the same schema. CIA queries default to the live table; archive queries are explicit. This is not part of V1 implementation — it's deferred until the live table volume warrants it. Note added here so the policy is documented in advance.

---

## Process for adding new event types

1. Add the event type to this document with description, producer, consumers, scope, severity, and payload shape
2. Add a Zod schema for the payload in `_shared/event_schemas.ts`
3. Update the database CHECK constraint to include the new type
4. Implement the producer agent
5. Update consumer agents to subscribe (if applicable)

The document is the source of truth. Code follows the document.

---

## What this taxonomy does NOT cover

- Agent internal state (working memory, cache, intermediate computations)
- User actions (approvals, rejections — those live in `pending_actions`)
- Audit log entries (those live in `agent_runs`)
- UI events, telemetry, analytics

If an agent needs to record something for itself or for users that isn't a credit event in the business sense, it goes in a different table — not `credit_events`.

---

## Open questions (resolved)

- ✅ severity_score and qualitative severity kept in sync automatically by publishEvent helper
- ✅ summary field AI-generated at emit time for severity ≥ medium; templated for lower severities
- ✅ corroboration across sources handled via separate events sharing correlation_id; producers don't deduplicate
- ✅ scope enum stays at five values (customer/country/industry/currency/portfolio)
- ✅ INTEREST_RATE_CHANGE is a country-scoped event produced by Country Risk Monitor
- ✅ RISK_CHANGE single event type with change_type discriminator (escalation/downgrade/upgrade/cleared)
- ✅ UTILIZATION_THRESHOLD_BREACH single event type covering both approaching and exceeding limit
- ✅ Article body NOT stored in NEWS_EVENT payload; URL + AI summary only
- ✅ Old events archived (not deleted) after 24 months; policy deferred to a later session
- ✅ RISK_STABLE_REVIEW removed from V1
- ✅ NEGATIVE_NEWS + POSITIVE_NEWS collapsed into single NEWS_EVENT with sentiment + subcategory in payload — news is open-ended and resists fixed enumeration; subcategory grows over time without taxonomy changes
- ✅ SEC_FILING_10K / 10Q / 8K dropped from V1 — these are filing types, not events. Filing type lives in the payload (`filing_source_type`) of typed SEC events
- ✅ SEC events stay typed for common concerns (COVENANT_WAIVER, CEO_DEPARTURE, REVENUE_MISS, GOING_CONCERN) + SEC_OTHER catch-all for the long tail with `concern_category` discriminator

## Open questions (deferred to V2)

- Muted/suppressed flag for events the user has explicitly dismissed — revisit once real user feedback indicates demand
- Backpressure handling for high-volume monitor events — V1 sidesteps this by emitting at the right scope (environment events rather than per-customer fan-outs); revisit if needed
