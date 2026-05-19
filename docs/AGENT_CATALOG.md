# CreditPilot Agent Catalog

**Status:** Working document — not in GitHub
**Last updated:** 2026-05-14 (updated)
**Purpose:** Single source of truth for which agents exist, which are planned, and how they're categorized. Used to scope the event taxonomy and prioritize build order.

---

## How agents communicate

CreditPilot agents do not call each other directly. They communicate by publishing events to the `credit_events` table and subscribing (via Supabase Realtime) to event types they care about. When an event of a relevant type lands, the subscribed agent wakes up and processes it.

This is **event-driven architecture with pub/sub** — the standard pattern for decoupled multi-agent systems.

**Cascade mechanics:**

- Every event carries a **`correlation_id`** linking it to the original triggering event. All events in a cascade share one correlation_id.
- Every event carries a **`triggered_by`** field referencing the immediate parent event id. Used to reconstruct the full causal tree.
- Agents declare which event types they consume. A new agent is added by writing it and subscribing it — no existing agent needs to change.

**Worked example:** Country Risk Monitor detects Brazil sovereign downgrade → emits `COUNTRY_RATING_CHANGE` with correlation_id=abc-123 → FX Agent and Risk Agent both wake up → FX Agent emits `FX_EXPOSURE_FLAG` (same correlation_id) → Risk Agent emits per-customer `RISK_ESCALATION` events (same correlation_id) → Recommendation Agent emits limit-adjustment recommendations into `pending_actions` (same correlation_id) → User opens CreditPilot, sees the cascade as one coherent story in the morning briefing.

**Customer-scoped vs environment-scoped events:** Some events apply to one customer (e.g. negative news on Triumph Group). Others apply to an environment that touches many customers (e.g. a country downgrade). Environment-scoped events use `customer_id = null` plus a `scope` field (`country`, `industry`, `currency`, `portfolio`). Downstream agents do their own customer enrichment — figuring out which customers are affected is the consumer's job, not the producer's.

---

## Categories

- **Monitor** — watches a customer-specific data source, emits events tagged to customers
- **Enrichment Monitor** — watches an environmental signal (country, industry, currency, regulatory), emits events tagged to the environment
- **Synthesizer** — reads events, produces higher-level signals
- **Action Agent** — produces concrete recommendations or executes actions (subject to human approval)
- **Generator** — produces a document or report on demand
- **Conversational** — answers user questions; doesn't run on a schedule

---

## V1 priority — risk-focused for the company

### Customer-specific monitors

**News Monitor** — Monitor
*Status: live*
Watches news APIs (Bloomberg, Reuters, GDELT, NewsAPI, sector feeds) for stories about customers.
Emits: `NEGATIVE_NEWS`, `POSITIVE_NEWS`

**SEC Monitor** — Monitor
*Status: live*
Watches SEC filings (10-K, 10-Q, 8-K) for material disclosures.
Emits: `SEC_FILING_10K`, `SEC_FILING_10Q`, `COVENANT_WAIVER`, `CEO_DEPARTURE`, `REVENUE_MISS`, `GOING_CONCERN`

**AR Aging Monitor** — Monitor
*Status: live*
Watches accounts receivable for overdue invoices and utilization thresholds.
Emits: `OVERDUE_INVOICE`, `UTILIZATION_THRESHOLD_BREACH`, `LIMIT_BREACH`

**Payment Behaviour Monitor** — Monitor
*Status: planned — high priority*
Watches payment patterns over time, detects trends rather than discrete events.
Emits: `PAYMENT_DETERIORATION`, `PAYMENT_IMPROVEMENT`, `PAYMENT_VOLATILITY`

### Enrichment monitors

**Country Risk Monitor** — Enrichment Monitor
*Status: planned*
Watches sovereign ratings, political risk indices, country economic indicators.
Emits: `COUNTRY_RATING_CHANGE`, `COUNTRY_POLITICAL_RISK`, `COUNTRY_ECONOMIC_SHOCK`

**Industry Risk Monitor** — Enrichment Monitor
*Status: planned*
Watches industry indicators — order books, commodity prices, sector indices, supply-chain disruptions, regulatory changes.
Emits: `INDUSTRY_DOWNTURN`, `INDUSTRY_DISRUPTION`, `REGULATORY_CHANGE`, `TARIFF_CHANGE`, `INTEREST_RATE_CHANGE`

**ESG Risk Monitor** — Enrichment Monitor
*Status: planned*
Watches ESG controversy databases (RepRisk, Sustainalytics), carbon disclosures, supply-chain audits.
Emits: `ESG_CONTROVERSY`, `CARBON_DISCLOSURE_FLAG`, `SUPPLY_CHAIN_ISSUE`

### Synthesizers

**FX Risk Agent** — Synthesizer
*Status: planned*
Reads country events and currency-relevant signals. Computes portfolio FX exposure, flags currencies needing attention.
Reads: `COUNTRY_RATING_CHANGE`, `COUNTRY_ECONOMIC_SHOCK`, customer transaction currencies
Emits: `FX_EXPOSURE_FLAG`, `FX_HEDGING_NEEDED`, `CURRENCY_VOLATILITY`

**Risk Agent** — Synthesizer
*Status: planned — first synthesis agent to build*
Reads events from all monitors (customer-specific + enrichment), assesses whether a customer's overall risk profile has changed, writes synthesized risk events with reasoning.
Reads: all customer-tagged events plus all enrichment events (resolves to affected customers)
Emits: `RISK_ESCALATION`, `RISK_DOWNGRADE`, `RISK_STABLE_REVIEW`

**Concentration Risk Monitor** — Synthesizer
*Status: planned*
Watches the portfolio as a whole. Flags excessive exposure to one customer, sector, country, currency.
Reads: customers, current_exposure
Emits: `CONCENTRATION_THRESHOLD_BREACH`

**Forecaster Agent** — Synthesizer
*Status: planned*
Reads historical events and current state, projects portfolio-level trends forward. Identifies emerging concentration risks, suggests safe expansion or targeted reductions.
Reads: all events + historical customer/exposure data
Emits: `PORTFOLIO_INSIGHT`, `CONCENTRATION_WARNING`, `EXPANSION_OPPORTUNITY`

**Horizon Scanner Agent** — Synthesizer
*Status: planned*
Long-range prospective analysis. Watches macro signals, emerging risk themes (geopolitical, technology, climate, supply-chain) and surfaces early warnings before they hit individual customers.
Reads: external macro feeds, regulatory developments, climate data, sector intelligence
Emits: `EMERGING_RISK_SIGNAL`, `MACRO_TREND_WARNING`

### Action agents

**Recommendation Agent** — Action Agent
*Status: planned*
Reads risk signals from the Risk Agent and recommends specific actions (limit changes, watchlist additions, monitoring frequency increases). Writes to `pending_actions` for human approval.
Reads: `RISK_ESCALATION`, `RISK_DOWNGRADE`, `CONCENTRATION_THRESHOLD_BREACH`, others
Produces: actions in `pending_actions` queue

**Liquidity Orchestrator Agent** — Action Agent
*Status: planned*
Watches the user's own cash flow projections and customer payment expectations. Proposes timing actions to keep working capital aligned with operational needs.
Reads: payment behavior, AR aging, customer payment terms, internal cash projections
Emits: `LIQUIDITY_GAP_FORECAST`
Produces: timing recommendations

**Working Capital Optimizer Agent** — Action Agent
*Status: planned*
Reads payment behavior, exposure, terms across the portfolio. Recommends changes to payment terms, collection acceleration, term restructuring to optimize working capital.
Reads: payment events, exposure, customer terms
Produces: term-change and process recommendations

**Dispute and Exception Handler Agent** — Action Agent
*Status: planned*
Listens for AR events involving disputes or exceptions. Manages the dispute workflow — drafts communications, tracks status, escalates aging disputes.
Reads: `DISPUTE_OPENED`, `OVERDUE_INVOICE` (with dispute flags)
Emits: `DISPUTE_OPENED`, `DISPUTE_RESOLVED`, `EXCEPTION_ESCALATED`
Produces: dispute correspondence, escalation actions

**Value & Opportunity Engine** — Action Agent
*Status: planned*
Surfaces upside opportunities, not just downside risk. Dynamic discounting, factoring options, supply chain finance, credit-decision opportunities for new lines.
Reads: payment behavior, customer financial health, market rates, trading volume
Emits: `OPPORTUNITY_IDENTIFIED`
Produces: opportunity recommendations

### Conversational

**CIA — Credit Intelligence Agent** — Conversational
*Status: live*
Answers user questions in natural language by reading events written by all other agents. Also produces a morning briefing.
Reads: all events
Produces: answers and briefings; does not emit events

---

## V2+ — secondary priority

### Customer lifecycle

**Onboarding Agent** — Synthesizer
*Status: planned*
Runs once per new customer at intake. Pulls credit ratings, financials, SEC data, news history, sanctions check, ESG flags. Sets initial credit limit proposal, scenario, risk tags.
Reads: external data on a new customer
Emits: `CUSTOMER_ONBOARDED`, `RATING_ASSIGNED`, `INITIAL_LIMIT_PROPOSED`

**Compliance Agent** — Monitor
*Status: planned*
Screens customers against sanctions lists (OFAC, EU, UN), anti-bribery databases, export control regimes. Watches for compliance documentation gaps.
Emits: `SANCTIONS_HIT`, `EXPORT_CONTROL_FLAG`, `COMPLIANCE_REVIEW_REQUIRED`, `DOCUMENTATION_GAP`

**Collector and Recovery Agent** — Action Agent
*Status: planned*
Reads payment behavior and overdue invoice events. Drafts collection letters, suggests escalation paths, recommends write-offs versus pursuit.
Reads: `OVERDUE_INVOICE`, `PAYMENT_DETERIORATION`, customer history
Produces: draft letters, escalation actions

**Trade Reference Generator** — Generator
*Status: planned*
On request from an external party, produces a reference letter about a customer's payment behavior and trading history.
Reads: customer payment history, invoice records
Produces: reference letter document
*Does NOT emit events.*

### Other

**Trade Credit Insurance Decision Agent** — Action Agent
*Status: optional, for insured books*
Decides which customers warrant insurance coverage, when coverage is cost-effective, when to drop existing coverage.

**Briefing Generator** — Generator
*Status: currently part of CIA*
Produces scheduled portfolio briefings (daily, weekly, monthly).
*Could be extracted from CIA into its own agent later.*

---

## Build order recommendation (V1 risk cluster)

1. Payment Behaviour Monitor
2. Country Risk Monitor + Industry Risk Monitor
3. Risk Agent (first synthesizer — proves the cascade pattern)
4. Recommendation Agent
5. FX Risk Agent
6. Concentration Risk Monitor + Forecaster
7. Horizon Scanner
8. Liquidity Orchestrator, Working Capital Optimizer, Dispute Handler, Value & Opportunity

Then V2: Onboarding, Compliance, Collector, Trade Reference, Insurance.

---

## Open questions to resolve before implementation

- **Cadence vs trigger.** Most agents will be event-triggered (Supabase Realtime). Some (Forecaster, Horizon Scanner) run on a schedule. Document each agent's actual trigger mechanism in the taxonomy.
- **Idempotency.** When an agent re-runs after a crash, it shouldn't reprocess events. Per-event-per-agent processed flag.
- **Retirement.** Deprecated event types remain in the taxonomy with a `deprecated_at` timestamp; consumers stop subscribing.
- **Backpressure.** Mass-event scenarios (e.g. Country Risk Monitor emits 50 events in one run) require either batching at the producer or rate-limiting at the consumer.
