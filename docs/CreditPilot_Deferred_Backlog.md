# CreditPilot — Deferred Work Backlog

**Status:** Working document — not in GitHub (or commit to docs/ if useful for the audit)
**Last updated:** 2026-07-03
**Purpose:** Capture everything started-but-not-finished or explicitly deferred during the V1 taxonomy implementation, so it isn't lost. Reviewed and worked through after the agent-architecture standardization.

---

## Context

The V1 event taxonomy foundation is complete and enforced:
- credit_events has new columns (scope, severity_score, correlation_id, summary)
- agent_processed_events table exists (idempotency)
- event_schemas.ts (Zod schemas) + publishEvent.ts (gateway) built
- Existing data migrated to V1 event-type names
- event_type locked by CHECK constraint
- SEC Monitor refactored onto publishEvent (Option C)
- SEC Monitor demo parity DONE — demo runs the real pipeline via a seed table (commit 805ad07)

**The SEC Monitor is now the REFERENCE IMPLEMENTATION.** News and the AR rebuild copy its shape:
- Data-source boundary for demo parity: a `fetchSeed*()` function reads a seed table; the agent switches `DEMO_MODE ? seed : live` at the fetch point only; all downstream logic (processing, publishEvent, notify) is shared between demo and production.
- Emission through publishEvent (validated payloads, severity reconciliation, correlation_id).
- Error capture on Supabase queries (destructure `error`, not just `data`, and log it) — the missing version of this hid a real bug.
- Human-readable titles (describe what happened, not the event_type name).

This "contract" lives as working code in sec-monitor-agent, not as an abstract spec. Next agents mirror it.

The agent-architecture work (originally framed as writing an Agent Contract document) resolved into: prove the pattern in one real agent (SEC, done), then copy it. No separate framework needed.

---

## A. Directly tied to the agent-architecture work

> **History correction (important):** We long believed "the AR Aging agent was deleted in commit a6b2dae." That is FALSE. a6b2dae *modified* the file; it survived in git history. What we actually had was a *working-tree-only* deletion — the file was absent from disk but alive in HEAD, recoverable with `git restore`. It has now been restored. Nothing was ever lost. The lesson stands (small commits + diff review + `git log --diff-filter=D` catch this), but the specific "Claude Code deleted it in a bundled commit" story did not happen. The file's removal from the working tree is unexplained but harmless (the agent was non-functional against the V1 schema anyway).

**A1. SEC Monitor DEMO_MODE bypass. ✅ RESOLVED (commit 805ad07).**
Replaced the pre-baked-log bypass with a seed-table data-source boundary. Demo now runs the real pipeline. Also fixed a pre-existing latent bug (sec_monitoring.risk_signals → risk_signals_detected) that the bypass had been hiding from both demo and production.

**A2. News Monitor refactor. ✅ DONE (commit 63ba803).**
Migrated onto publishEvent + NEWS_EVENT + demo parity via seed_news, following the SEC reference pattern. Both emit paths (Tavily + legacyPath) now emit NEWS_EVENT. Found and fixed two pre-existing latent bugs the bypass had hidden: the customers query wasn't targeting demo customers, and the negative_news upsert used ON CONFLICT against a PARTIAL unique index (impossible to match) so every insert silently errored — switched to plain insert. Also added a 5th seed customer (Triumph) to back its NEGATIVE_NEWS risk tag, which restored q2 to High. Harness 8/8. NEWS_EVENT schema fix (source free-form / provider enum / nullable url) committed separately as a9dfa47.

**A3. AR Aging agent rebuild. — UTILIZATION HALF ✅ DONE (commit e9825a2). Overdue half deferred to B4.**

Utilization-only build shipped on the reference pattern: emits UTILIZATION_THRESHOLD_BREACH via publishEvent, with a risk-aware filter (high utilization alone is not a risk — only emitted when over-limit OR combined with a weak credit signal). Preserves the payment-behaviour write-back to customers (CIA depends on those fields; AR is sole writer). Pre-V1 plumbing removed: the old agent emitted seven types (OVERDUE_BUCKET_*, CRITICAL/HIGH_UTILIZATION, CONCENTRATION_RISK), none of which are in the V1 CHECK constraint — the old file could not write to the current schema at all. CONCENTRATION removed entirely (belongs to a future portfolio agent, not AR).

**Prerequisite data fix surfaced and corrected** during the rebuild: ar_aging_snapshots.utilization_pct and credit_limit were systematically inconsistent with the authoritative customers.current_exposure/credit_limit across ~15 customers (e.g. Spirit stored 180 vs computed 90; several stored 0.00 with real exposure; 9 customers had a snapshot credit_limit different from the customers row). Corrected via direct UPDATE on the latest snapshot per customer (manual DB fix, not a migration). Schema-hygiene smell logged for the audit: ar_aging_snapshots duplicates credit_limit, inviting drift — consider joining to customers instead.

**What is NOT in the build (deferred):**
- The overdue/OVERDUE_INVOICE half. Pending B4's decision on grain (per-invoice vs filtered-material vs per-customer-aggregate; ~157 overdue invoices in the demo make naive per-invoice emission noisy).
- Dunning letters (stages 1-4 via compose-dunning-letter) and the over-90 Teams alert. Both are overdue-AR concerns, not utilization — they return when the overdue half is built.
- A separate Payment Behaviour Monitor (which would emit PAYMENT_* events and take over the payment-behaviour write-back currently held by AR).

**Architecture note — overdue stays in the AR agent (not a separate agent).** Overdue and utilization are both AR-health signals over the same data (invoices/snapshots), same customers, same cadence — so the overdue half gets added back to THIS agent after B4. End state: AR emits both UTILIZATION_THRESHOLD_BREACH and OVERDUE_INVOICE, with dunning attached to the overdue side.

**A4. Shared notify() helper. (DEFERRED TO V2.)**
Agent contract rule, now established: **emit once, notify separately.** Each agent emits an event via publishEvent exactly once per finding (the detect/emit phase), then a separate notification phase composes Teams/Slack/email alerts for the serious findings — that phase CONSUMES events/findings and never writes credit_events itself. SEC already follows this. The News refactor (A2) brings News in line by removing its duplicate credit_events insert from the alert path.

Once both SEC and News are on the contract, the notification phase is near-identical in both (composeTeamsAlert/deliverMessage + agent_messages insert). Extract it into a shared `notify()` helper — the notification analog of publishEvent — so all agents notify uniformly and AR/future agents inherit it. Channel-agnostic (Teams now, Slack/email later). Deferred to V2 — do not build the shared helper until the shared shape is proven in two agents and there's real need; for now each agent keeps its own notification code.

---

## B. Taxonomy / documentation cleanup

**B1. Update taxonomy doc: parent_event_id vs triggered_by.**
The taxonomy doc refers to a `triggered_by` field for cascade tracking. In implementation we kept the existing `parent_event_id` column instead (same concept, better name). Update docs/EVENT_TAXONOMY.md everywhere it says triggered_by to say parent_event_id, and note the root-event convention (parent_event_id null, correlation_id = own id).

**B2. Confirm repo taxonomy doc is the revised version.**
We revised the taxonomy mid-implementation (collapsed NEGATIVE_NEWS + POSITIVE_NEWS into NEWS_EVENT; dropped SEC_FILING_10K/10Q/8K; added SEC_OTHER; added filing_source_type to typed SEC events). Confirm docs/EVENT_TAXONOMY.md in the repo reflects all of this and matches event_schemas.ts. (Believed done, but verify.)

**B3. publishEvent run_id field.**
We discussed adding an optional run_id passthrough to publishEvent for the audit trail, then decided to let it go for SEC (run_id is still recorded in agent_runs / agent_messages). Revisit when standardizing agents: decide whether the Agent Contract wants run_id on credit_events rows for traceability. If yes, add it to publishEvent's interface once, for all agents.

---

**B4. Bounded taxonomy consistency pass. — COMPLETED 2026-05-31.**
Walked all 29 V1 event types. Results below; the work is captured here in the backlog rather than as a separate doc so it stays with the rest of pre-audit planning.

**Built-agent groups (8 types):**
- ✅ Clean and verified end-to-end against real data: NEWS_EVENT, UTILIZATION_THRESHOLD_BREACH.
- ⚠️ Schema clean but agent can't yet populate (blocked on C4 — structured SEC extraction): COVENANT_WAIVER, CEO_DEPARTURE, REVENUE_MISS, GOING_CONCERN. Currently emitted via SEC_OTHER with concern_category as a stopgap. C4 promotes them to typed events when extraction is built.
- ✅ Working as intended: SEC_OTHER (deliberate catch-all).
- ❌ → ✅ Resolved this session: OVERDUE_INVOICE → renamed to OVERDUE_AR, per-customer-aggregate grain. See the dedicated OVERDUE_AR block above for the full decision and target payload.

**Unbuilt-agent groups (21 types):**
Internal-coherence pass only — true fitness check happens at agent-build time. Real findings below.

**Schema bugs to fix in B4 itself (the two summary-field omissions; addressed in commit alongside this update):**
- **PAYMENT_VOLATILITY** is missing the `summary` field. publishEvent requires summary for severity >= medium, so without it the event would fail validation in production. Adding `summary: z.string()`.
- **CURRENCY_VOLATILITY** has the same gap. Same fix.

**Schema-level findings logged for the agent-build session (don't block until the relevant agent is built):**

- **TARIFF_CHANGE.affected_sectors** uses `z.array(z.string())` instead of `z.array(SectorEnum)`, inconsistent with every other sector field. Possibly intentional (tariffs hit sub-industries that don't map to the canonical sector enum); discuss when the Industry Risk Monitor is built and decide whether to constrain or document the exception.
- **CEO_DEPARTURE** — schema field is `executive_name` (broader than CEO) while the type name is CEO_DEPARTURE. Consider renaming to EXECUTIVE_DEPARTURE when C4 promotes the typed event. Touches the CHECK constraint and taxonomy doc, so it's not a B4 in-line fix.
- **MACRO_TREND_WARNING duplicates EMERGING_RISK_SIGNAL** — identical payload schemas, two event types. Either differentiate or collapse one when the Risk Agent is built.
- **EMERGING_RISK_SIGNAL uses `confidence` instead of `severity_score`** — breaks the V1 severity convention. B5's ranking-priority rule will need a translation (confidence -> severity_score) or to exclude these from the ranking. Document the convention.

**Definition gaps to pin at agent-build time (no schema change today, but the agent designer must answer these before encoding):**

- **REVENUE_MISS.expected_revenue_usd** — expected by whom? Analyst consensus, company prior guidance, or prior-period actual? These produce different "miss" interpretations. Pin before C4 builds extraction.
- **REVENUE_MISS.period** — currently `z.string()`. Constrain to a known format (e.g. "YYYY-QN" or "YYYY-MM-DD" period-end) when populated.
- **PAYMENT_DETERIORATION / PAYMENT_IMPROVEMENT** — `current_avg_days_to_pay` vs `prior_avg_days_to_pay`: what's the split? Last 30 days vs previous 30? Schema says `observation_window_days` but doesn't separate the two windows. Pin when the Payment Behaviour Monitor is built.
- **PAYMENT_DETERIORATION / IMPROVEMENT.trend_direction** — field name misleading (the value is a degree of deterioration / improvement, not a direction). Cosmetic rename when the agent is built; acceptable today.
- **PAYMENT_VOLATILITY / CURRENCY_VOLATILITY** — schema gives no firing rule. Volatility against what baseline triggers an event? Define at agent-build time.
- **INTEREST_RATE_CHANGE** — central banks change rates regularly; no inherent threshold in the schema. Country Risk Monitor will need a firing rule (e.g. only when change >= X bp) so the feed doesn't flood.
- **INDUSTRY_DOWNTURN** — three open questions: what counts as `indicator` (PMI? sector index? employment? sector revenue?), what `period_days` covers (rolling, YoY, custom?), and the sign convention on `change_percent` (positive vs negative for downturn). Pin when the Industry Risk Monitor is built.

**Cross-cutting conventions to document (not bugs, but worth pinning):**

- **Positive events don't carry `severity_score`** (EXPANSION_OPPORTUNITY, PORTFOLIO_INSIGHT). Defensible — positives aren't graded by severity — but should be documented in the taxonomy as the V1 convention.
- **Severity_score on improvement events** (PAYMENT_IMPROVEMENT) is mildly inconsistent — severity is "how bad," improvement isn't bad. Interpreting it as "magnitude of improvement" is a stretch. Either accept the dual meaning and document, or drop severity_score from improvement events (preferred long-term, but breaks symmetry with deterioration).
- **EMERGING_RISK_SIGNAL / MACRO_TREND_WARNING use `confidence`** instead of severity. Need a documented translation when B5 ranking encounters them.

**Light terminology check:** standard trade-credit and finance terms used correctly throughout (DSO, aging buckets, utilization, dunning stages, covenant, going-concern, downgrade, watch list, concentration). No industry-terminology issues found — these are foundational concepts with well-established meanings.

**Net effect on the work ahead:**
- B5 (risk-ranking encoding) — no blockers; the V1 priority rule reads severity_score from credit_events, which works for all events that have it. Plus the two summary-field fixes don't affect ranking. Two cross-cutting items (EMERGING_RISK_SIGNAL using confidence; positive events without severity_score) become small handling rules in the ranking code.
- AR overdue build — clear target: OVERDUE_AR event type with per-customer-aggregate payload, deprecating OVERDUE_INVOICE.
- C4 (structured SEC extraction) — no schema changes needed; the typed event schemas were verified ready to receive promoted SEC_OTHER events.
- Future-agent builds (Payment Behaviour, Country Risk, Industry Risk, Risk Agent, FX) — each has the build-time questions listed above as a checklist before encoding their first emission.

**B4 must decide the OVERDUE_INVOICE grain (deferred from the AR rebuild). — RESOLVED to per-customer-aggregate (Option C).** B4 decision (2026-05-31): the OVERDUE_INVOICE event type as defined (per-invoice grain: invoice_id, due_date, is_disputed) doesn't match the alerting use case. A credit manager wants "Customer X has $Y overdue, oldest 95 days, 12 invoices," not 157 individual invoice events. Resolution: **rename to OVERDUE_AR, reshape the payload to per-customer aggregate, deprecate OVERDUE_INVOICE.**

Target payload for OVERDUE_AR (to finalize when AR's overdue half is encoded): total_overdue_usd, bucket_1_30_usd / bucket_31_60_usd / bucket_61_90_usd / bucket_over_90_usd, invoice_count, oldest_invoice_days_overdue, optionally disputed_invoice_count and pre_petition_amount_usd. Severity probably scales with the worst bucket (over_90 > threshold → critical).

Per-invoice drill-down: data lives in the `invoices` table and is queryable on demand via the CIA (its keyword router already fires on "invoice/overdue/aging"). Per-invoice events are NOT needed for alerting; if a frontend drill-down view is wanted later, that's a UI task, not an event-taxonomy task. The data is there.

Deprecation is clean: OVERDUE_INVOICE has never been emitted in production (AR's overdue half was never built), so there's no historical data to migrate. Adding OVERDUE_AR to the CHECK constraint and removing OVERDUE_INVOICE happens when the overdue half of AR is built.

---

## B-prime. Customer identifier data model (IMPORTANT — do before the audit)

**Problem surfaced:** customer identification has no single key. US public companies have a SEC CIK + ticker; European public companies have LEI/ISIN/national registry numbers; private and export customers have none of those — maybe a DUNS, a national business-registration number, or a tax ID. A single `identifier` field can't hold a company's multiple IDs, and a column-per-type approach (current state: `customers.sec_cik`, `customers.ticker`) becomes a wide sparse table needing a migration per new identifier system. This was surfaced when a CIK error was found (Heliogen's sec_monitoring row pointed at a SPAC's CIK, 0001848948 instead of the correct 0001840292) and the realization that newly-added non-public/export customers won't have CIKs at all.

**Decision (tentative, to confirm when implementing):** a separate normalized `customer_identifiers` table — one row per identifier, extensible to any identifier system with no schema change.

Proposed shape:
```
customer_identifiers
  id            uuid PK
  customer_id   uuid → customers(id)
  id_type       text     -- controlled vocab: 'duns' | 'sec_cik' | 'ticker' | 'lei' | 'isin' | 'companies_house' | 'tax_id' | ...
  id_value      text
  is_primary    boolean  -- the main identifier of this type
  source        text     -- 'manual' | 'edgar' | 'dnb' | ...
  verified_at   timestamptz  -- when last confirmed against source-of-truth (directly addresses the Heliogen-style bug)
  created_at    timestamptz
  UNIQUE (customer_id, id_type, id_value)
```

Likely **DUNS as the primary identifier** — it's the only system covering both public and private companies globally, which fits the mixed public/private/export portfolio. id_type should be a controlled vocabulary (same discipline as the event taxonomy), not free text.

Open sub-questions for implementation:
- What identifiers do the existing non-public/export customers actually have today? (Determines which id_types are needed day one.)
- Clean Option 3 (migrate sec_cik/ticker into the table, single source of truth) vs hybrid (keep columns + table). Leaning clean — avoids the column-vs-table disagreement that is exactly the class of bug we're hunting.
- Migration: update the SEC Monitor (and anywhere CIK is read) to read from customer_identifiers. Only SEC uses an identifier today, so the change is small now and grows expensive later — argues for doing it before more monitors are built.

**Sequencing:** do this as its own focused task, after the current outstanding agent work and before the engineer audit. Not to be interleaved with the SEC seed-data / agent-architecture work.

**Also fix while here:** the Heliogen CIK in sec_monitoring is wrong (0001848948 → should be 0001840292). One-line UPDATE; do it as part of either the identifier work or the SEC seed work, whichever comes first. And run a full CIK-vs-EDGAR verification pass across all customers (batch-pull EDGAR's official company name per CIK, flag mismatches) to catch any other errors like Heliogen's.

---

## C. Accuracy / quality tooling (the real product risk — see discussion)

These address the "wrong events" and "missed events" risks. None are blocking, but they're the substance of making CreditPilot trustworthy. Roughly priority-ordered.

**C1. Feedback loops.**
Thumbs up/down on CIA answers; track which recommendations the user approves/rejects and why; use this to calibrate confidence and severity over time. Currently the user doc implies this exists ("learns from what you do") — it does not yet. Either build it or soften the doc language until it does.

**C2. Corroboration in the Risk Agent.**
The taxonomy supports corroboration (separate events sharing correlation_id). When the Risk Agent is built, it should treat multiple corroborating events on one customer within a short window as a stronger signal than a single event. This is the main accuracy multiplier for the "wrong events" risk.

**C3. Coverage expansion (the "missed events" risk).**
Every monitor added narrows the blind spot. Priority gaps per the agent catalog: Payment Behaviour Monitor, Country Risk Monitor, Industry Risk Monitor. These are net-new agents (built to the Agent Contract once it exists).

**C4. Structured SEC extraction.**
Build extraction so covenant_waiver and CEO_departure detections can populate the structured fields (waiver_date, waived_covenant, executive_name, departure_type, departure_date) and be promoted from SEC_OTHER to their typed events (COVENANT_WAIVER, CEO_DEPARTURE). The taxonomy already defines these typed events; only the extraction is missing. Likely a Claude call that reads filing text and returns structured JSON.

**C5. "Stale coverage" signal (idea).**
Consider an event/alert for "we have no recent information on this large exposure" — absence of data as a signal. Worth designing once the monitor set is broader.

---

**D0c. Demo payment-transactions data is unrealistically uniform. (NEW — found during AR rebuild; needed for the Payment Behaviour Monitor.)**
Every customer whose payment behaviour has been computed lands on `payment_health = 'watch'` — and only the 23 AR-processed customers have any payment_health at all (the other 36 are null, never computed). analysePaymentBehaviour classifies `watch = on_time_rate < 0.70 OR avg_days_early_late > 15`; the demo payment_transactions evidently make everyone "consistently late but stable," so nobody comes out 'healthy', 'at_risk', or 'deteriorating'. Consequences: (1) 'watch' carries no discriminating information in the demo (it's universal among computed customers); (2) the `at_risk` and `deteriorating` weak-signal conditions in the AR utilization filter effectively never fire in demo, so that filter reduces to "credit_rating_score < 50" — fine for now (score is a real discriminator) but payment behaviour isn't contributing. When the Payment Behaviour Monitor is built, the demo payment_transactions need a realistic spread (some genuinely healthy, some at_risk, some deteriorating) so payment signals are meaningful and the PAYMENT_* events have real variety. Also: that monitor should populate payment_health for ALL customers, not just the high-utilization subset AR happens to process. Low priority until the payment agent.

**B5. Risk-ranking priority — DESIGN DONE, encoding pending B4.**
Locked V1 priority list lives in `/mnt/user-data/outputs/CreditPilot_Risk_Ranking_Priority_V1.md`. Summary of the rule:

- **High-risk set membership:** `current_exposure > 0 AND (credit_rating_score < 30 OR bankruptcy)`. Bankruptcy triggers (any of): scenario='bankruptcy', risk_tags contains 'BANKRUPTCY', a GOING_CONCERN event in credit_events, or latest ar_aging_snapshots.pre_petition_amount > 0.
- **Ranking (lexicographic):** ORDER BY current_exposure DESC, sum of severity_score over last 90 days DESC, latest event date DESC NULLS LAST.
- **Answer:** the entire qualifying set (currently 7 customers in demo), not a top-N truncation.
- Triumph (score 32) is consciously OUT of the V1 set — falls outside score<30. Will surface via other CIA paths.

**Outstanding bug in HEAD:** The CIA's customer retrieval for portfolio-level questions is ordered by credit_limit (size) and capped at 20 — so the worst-rated customers can be invisible to risk questions (Triumph at limit 2M sat at position 22). A merged-fetch fix was prototyped this session and reverted (q4 source-array regression); the bug remains live in HEAD. The encoded V1 ranking REPLACES this retrieval path for portfolio-risk questions, which fixes the bug as a side effect.

**Encoding (deferred until after B4):**
1. Add a ranked-customers query implementing the V1 rule (likely a SQL function or RPC) — replaces the current credit_limit-ordered fetch in cia-agent.
2. Surface the ranked set in CIA's portfolio-level context (portfolio-risk questions only; named-customer and sector paths unchanged).
3. Rewrite q1 harness expectation (`must_mention` currently just ["Arconic"] as a placeholder — real expectation comes from the V1 set: likely some bankruptcy customers + at least one score<30 name).
4. Verify 8/8, with deliberate check that q4 doesn't regress this time (lesson from the reverted prototype).

Why deferred until after B4: severity_score values across event types are an input to V1 ranking; the bounded taxonomy pass may adjust some severities or grain. Encoding B5 first risks rework. Order: B4 first (mechanical, surfaces grain/severity issues), then encode B5 on clean foundations.

## D. Deferred V2 features (explicitly parked during taxonomy design)

**D0. Demo repeatability (state reset). (NEW — found during News refactor.)**
Demo re-runs are not repeatable: an agent dedups against its working table (negative_news for News, sec_filings for SEC) by fingerprint/accession, so the FIRST demo run produces events but subsequent runs skip everything already inserted and produce nothing new. This is CORRECT production behaviour (don't re-emit the same finding every run) but makes demo non-repeatable without a manual reset (we cleared the fingerprinted negative_news rows by hand to re-verify). Fix: a demo-only state reset at the start of a run — `if (DEMO_MODE) { clear the demo-generated rows for the seed entities }` — so re-running the demo always regenerates the full set. MUST be gated on DEMO_MODE so production is unchanged (the single DEMO_MODE flag stays the only demo/prod difference). Applies to SEC and News alike — do it uniformly, ideally as a small shared helper, when convenient.

**D0b. Stale hand-placed negative_news demo rows. (NEW — found during News refactor.)**
negative_news contains ~32 old hand-placed demo rows from 2026-02-27 (Spirit, Rite Aid, Yellow, McDermott, Proterra, etc.) plus a few from April/May, all with NULL content_fingerprint (not pipeline-generated). These predate the seed_news→pipeline approach. They should be cleaned out so demo news data = pipeline output only. BEFORE deleting: confirm the harness (q4 negative_news) doesn't depend on any of them — q4 currently passes reading the pipeline-generated rows, but verify. Low priority, data-hygiene.


**D1. Muted/suppressed flag.**
A way for users to dismiss events they've reviewed so they stop being surfaced as new. Deferred until real user feedback shows the actual pattern. Don't build speculatively.

**D2. Backpressure / batching for high-volume events.**
V1 sidesteps this by emitting at the right scope (environment events rather than per-customer fan-outs). Revisit only if a real volume problem appears.

**D3. Archival job.**
Policy is documented (events > 24 months move to credit_events_archive). The actual periodic job is not built. Build when live-table volume warrants it — not urgent at current scale.

**D4. Sources panel UX.**
Customers-table rows should appear as source cards in the CIA's sources panel (currently only credit_events rows do). Frontend work, deferred.

---

## E. Security / ops hygiene

**E1. Rotate the dev database password.**
The database password was exposed in a chat during setup. Reset it (Supabase dashboard → Settings → Database → Reset database password) and update DATABASE_URL in the terminal and ~/.zshrc. The anon key does not need rotating (public by design).

**E2. DATABASE_URL handling.**
DATABASE_URL (with password) may be sitting in ~/.zshrc in plaintext. Acceptable for a dev database; revisit before anything production-facing (use a secret manager).

---

## Suggested order — what's actually next

**Critical-path pre-audit:**
1. **B0 — Demo Data Rebuild (Option B).** Plan locked 2026-06-02 in `/mnt/user-data/outputs/CreditPilot_B0_Rebuild_Plan.md`. Multi-session effort: complete audit, settle four user-facing design decisions (input contract, identifier resolution, currency=USD-only, country=address country), apply schema + data migrations, verify. Absorbs B-prime (customer_identifiers + EDGAR verification), addresses D0b (stale negative_news cruft), and D0c (payment_transactions realism). Surfaced because three sessions of agent work each discovered the same kind of data rot.
2. **B5 encoding** — V1 priority rule (locked design in `CreditPilot_Risk_Ranking_Priority_V1.md`). Encode after B0 so the encoding builds on clean data. Fixes the live credit_limit-ordered retrieval bug.

B4 is done. B5 design is done. B-prime is absorbed into B0.

**Small / housekeeping (do anytime):**
- B3 (publishEvent run_id decision), CLAUDE.md to repo root, confirm E1 (dev DB password rotation done).
- **q4_negative_news is intermittently flaky on `min_sources >= 2`.** The model sometimes structures 2 NEWS_EVENT sources in the formal array (Arconic + Triumph), sometimes only 1, even though the answer prose consistently names multiple negative-news customers with rich data. Observed at least twice. Re-running typically clears it. Options when convenient: lower `min_sources` to 1, or add a "must_mention" content check. Don't lower the bar mid-task; do this as deliberate test maintenance.

**Then:** engineer audit of the repo.

**Post-audit:** the accuracy/coverage substance — Risk Agent + corroboration (C2), priority new monitors including Payment Behaviour (C3), feedback loops (C1). Structured SEC extraction (C4) when convenient; B4 confirmed the typed-event schemas are ready to receive promoted SEC_OTHER events. V2 features (D) as needs emerge — including multi-currency support (D1d) as a real piece of work.

---

## F. Bugs surfaced during B0 Phase 4 (data-worked-around, fix later)

**F1. `fn_refresh_ar_aging` missing pre_petition guard on mid-range buckets.**
The aging refresh function filters `bucket_over_90` with `status != 'pre_petition'`, but the `bucket_1_30`, `bucket_31_60`, and `bucket_61_90` filters have NO such guard. A `pre_petition` invoice with `days_overdue` in 1–90 is counted twice: once in `pre_petition_amount`, once in the overdue bucket — inflating the snapshot total. Surfaced as Spirit Airlines doubling (1.08M → 2.16M) once B0 4a set pre_petition `outstanding_amount` to the real owed value. (The three other pre_petition customers — Rite Aid, Proterra, Yellow — escaped only because their days_overdue > 90, which the over_90 guard catches.)
**B0 workaround (data):** set `days_overdue = 0` on all pre_petition invoices (bankruptcy freezes normal collections aging), so they land only in `pre_petition_amount`.
**Still latently wrong:** any future upload producing a pre_petition invoice with positive days_overdue will double-count again.
**Fix:** add `AND status != 'pre_petition'` to the three mid-range bucket filters, matching the over_90 guard. Out of B0 scope (data-only; this is the production aging path). Do in the post-B0 view-and-function pass, alongside B5 / the deferred view updates.

**F2. Demo aging time is frozen.**
`invoices.days_overdue` is stale: 141 of 142 active invoices disagree with `CURRENT_DATE − due_date`. The refresh function reads `days_overdue` directly rather than recomputing from `due_date` vs `p_as_of`, so snapshot buckets are permanently anchored to whatever date the seed was frozen at. B0 deliberately did NOT re-anchor (kept the existing latest snapshot_date as the as-of label) to avoid rippling into which customers look distressed.
**Fix:** recompute `days_overdue` from `due_date` relative to "today" and re-bucket. Belongs with the payment-transactions realism / time-anchoring work (task #2 / D0c). Until then, the demo's AR aging reflects a fixed historical as-of date, not "now."

**F3. ar-aging-agent reads dropped `payment_transactions.amount` column.**
Line ~141 selects `amount`, dropped in Phase 3 (only `amount_paid` remains). The skill's amount-weighting silently falls back to equal weighting (`?? 1`). Non-tipping on demo data (all personas yield the same health label weighted or not — verified during 4g), but diverges on high-variance real amounts. Fix: change the AR select to `amount_paid`, map to the skill's `amount` field. Out of B0 scope (agent code). Do alongside F1.

**F4. `total_outstanding` on ar_aging_snapshots excludes pre_petition.**
`fn_refresh_ar_aging` computes total_outstanding as current+buckets, omitting pre_petition_amount — so `v_ar_aging_portfolio.total_outstanding` reads 77,897,000 while true exposure (incl. pre-petition) is 80,140,000. Pre-petition AR is arguably still outstanding (still owed, impaired collectability). Decide whether total_outstanding should include it; if so, fix in `fn_refresh_ar_aging` alongside F1. Function change — out of B0 scope.

**F5. `sec_monitoring` live schema has drifted ahead of (and away from) migrations.**
A fresh `supabase db reset` from the committed migrations would produce a different table than production. Verified 2026-06-06 by diffing `information_schema.columns` against all migrations.

Columns in the **live DB but absent from all migrations** (added outside migration control):
- `monitoring_active` boolean DEFAULT true
- `filing_types_monitored` text[] DEFAULT ARRAY['10-K','10-Q','8-K']
- `last_8k_date` date
- `risk_signals_detected` text[] DEFAULT '{}'  ← the agent reads/writes this column
- `next_scheduled_review` date
- `updated_at` timestamptz

Columns in **migrations but absent from the live DB** (either dropped or never applied):
- `risk_signals` text[] DEFAULT '{}'  ← base migration `20260228040341`; appears renamed to `risk_signals_detected` outside migrations
- `ai_risk_score` integer  ← migration `20260310125929`
- `ai_summary` text  ← migration `20260310125929`

**Impact:** `sec-monitor-agent` references `risk_signals_detected` (reads at line 96, writes at line 284). A fresh rebuild from migrations would produce `risk_signals` instead, breaking the agent. The `ai_risk_score`/`ai_summary` migrations applied but the columns don't exist in live — suggesting they were dropped manually.

**Fix:** write a catch-up migration that (a) renames `risk_signals` → `risk_signals_detected` if it exists, (b) adds the six live-only columns with their defaults, (c) drops `ai_risk_score` and `ai_summary` if they exist (matching the live state). Apply before the next `supabase db reset` or new environment setup. Out of B0 scope.

---

## G. Process notes (lessons captured during B5)

**G1. Column drops must grep for runtime string-literal readers, not just pg_depend.**
B5 dropped `customers.flags` after the pg_depend view-dependency check came back clean for the rewrites — but the cia-agent's `selectFields` is a runtime query built from a **string literal** (`"id, company_name, ..., flags, ..."`), which pg_depend cannot see. The drop succeeded, then q2/q5/q6/q7 broke (PostgREST errored "column flags does not exist" → CIA returned "I don't have", 0 sources). Fix was a one-line selectFields edit + redeploy.
**Rule for future column drops:** before dropping any column, run BOTH checks:
  1. `pg_depend` query for views/constraints (catches parsed dependencies).
  2. `grep -rn "<column_name>" supabase/functions src` for runtime readers — string-literal selects, `.select()` field lists, `c.<column>` property reads, RPC return mappings. These are invisible to pg_depend.
Applies to any future drops (e.g. the still-deferred `ticker`/`sec_cik` → customer_identifiers migration, which selectFields also references as `ticker`).

**Related note (not a bug, surfaced during G1):** `customers.ticker` and `customers.sec_cik` still exist live — the Identifier Strategy doc said B0 Phase 3 would drop them (migrate into customer_identifiers), but that step never ran. selectFields still reads `ticker`. When that migration finally happens, apply the G1 two-check rule and update selectFields in the same change.

---

## F-series resolutions (closed)

- **F1 — RESOLVED** (migration 20260607235000). Added `status != 'pre_petition'` guard to the three mid-range bucket filters (amount + count) in `fn_refresh_ar_aging`. Verified no-op on current data; per-customer reconciliation held (0 mismatches).
- **F3 — RESOLVED** (commit, ar-aging-agent). Changed the payment_transactions select to `amount:amount_paid` so the skill amount-weights correctly. Output identical on current data (weighted == equal-weighted verified); future-proofs high-variance amounts.
- **F4 — CLOSED AS BY-DESIGN** (doc: DEMO_DATA_CONTRACT.md). `total_outstanding` deliberately excludes pre_petition; `current_exposure` is the all-in figure. No code change.
- **F5 — RESOLVED** (migration 20260607234500). Catch-up migration adds the 6 unmigrated sec_monitoring columns + drops the stale ai_risk_score/ai_summary/risk_signals so a fresh rebuild matches live. No-op against current live.

F2 remains open (frozen demo aging time — tied to a future time-anchoring pass).

---

## A3 + session findings (2026-06-11)

**A3 — OVERDUE_AR core: DONE** (commit 8424bd4). OVERDUE_INVOICE → OVERDUE_AR, per-customer-aggregate grain. New OverdueArPayload (total + 4 buckets + invoice_count + oldest_days, optional disputed/pre_petition). AR agent emits one OVERDUE_AR per customer with active overdue invoices (status NOT IN paid/written_off/pre_petition, days_overdue > 0), severity by worst non-empty bucket (over_90→critical/92, 61_90→high/75, 31_60→medium/55, 1_30→low/30). Verified: 21 events, 3 high / 12 medium / 6 low, Arconic payload reconciles. CHECK constraint swapped (migration 20260609120000). event_schemas redeployed to ar-aging + news-monitor (both bundle _shared).

**A3 — STILL DEFERRED:** dunning letters (stages 1-4 via compose-dunning-letter) and the over-90 Teams alert. These consume OVERDUE_AR (emit-once-notify-separately) — build when the notify() helper / alert path is next touched.

**D0 (demo repeatability) — DONE FOR AR ONLY** (commit 8424bd4). AR agent now clears its own demo events (`source_agent='ar_aging_agent' AND is_demo=true`) at run start, gated on DEMO_MODE. Verified: re-run clears 65 stacked dupes → clean 20 util + 21 overdue. SEC and News still need the same reset (apply the same pattern when next touched).

**Two AR-agent bugs found + fixed during A3 verification:**
- Overdue query filtered input by `is_demo=DEMO_MODE` (inconsistent with utilization half, which reads v_ar_aging_current with no is_demo filter and only stamps output). Removed the filter — overdue now reads all invoices, stamps output is_demo=DEMO_MODE, emits all 21 (was 8). AR's data source is internal, so unlike SEC/News it has no seed-vs-live boundary — DEMO_MODE only stamps output + gates the demo reset.
- Wrong amount column (`outstanding_amount` → `amount_outstanding`, the generated canonical value).

**CIA event-fetch improvement** (commit 8424bd4). credit_events fetch was `.order(created_at DESC).limit(15)` — with 20+ utilization events, the most-severe (over-limit) ones could fall outside the window. Now `.order(severity_score DESC).order(created_at DESC).limit(30)` so the most severe events always survive the cap. Principled for all question types, not just q3.

**[RESOLVED 2026-06-17, commit 71795ea]** Fixed by the deterministic sources rework: sources are now built in code from `credit_events_matched`, not generated by the LLM meta call. The binary 0-or-many behavior was the LLM meta-call structured output flaking; that call no longer produces sources, so the intermittent is structurally impossible. Refinement 1 (commit 4980707) further reduced coincidental noise sources via keyword stoplist. Original note retained below for history.
**NEW BUG — CIA sources array intermittently empty (real, systemic).** q3/q4 min_sources flake root cause: the CIA's structured `sources` array comes back **binary 0-or-many** (observed q3: 0, 10, 8, 0 across consecutive runs) — when populated it has 8-10 sources, when not it has exactly 0, even though the answer prose consistently cites sources correctly. This is a structured-output reliability issue in the CIA, not a test problem. Test thresholds (q3 min_sources lowered 3→1, q4 already at 2) mask it; the underlying intermittent should be investigated — a user sometimes gets a correct answer with zero source attribution. Affects all question types. Priority: real product-quality bug, post-consolidation.

**q3 test adjustment** (commit 8424bd4). min_sources 3→1, expected_confidence [High]→[High,Medium]. must_mention [Ironwood, Kaman] KEPT (the real content gate — always passes; Ironwood at 123% and Kaman at 110% are correctly named every run). Relaxed only the two metadata checks that flake on correct answers (the sources-array bug above + model confidence self-rating variance).

**severity_score vs credit_rating_score — two opposite 0-100 scales (document).** credit_rating_score: 0-100, LOWER = worse (customer creditworthiness, user-facing). severity_score: 0-100, HIGHER = worse (event severity weight, internal ranking input, never shown as a raw number to users). Different scales, different directions, by design. Considered flipping severity_score to match — rejected: it's internal (users see critical/high/medium/low labels, not the number), flipping would make it inconsistent with its own severity label and require rework across publishEvent + B5 ranking + every agent. Documented instead. (Add to DEMO_DATA_CONTRACT.md when convenient.)

---

## D0 demo-repeatability — COMPLETE for all three agents (2026-06-12)

News + SEC now have the same DEMO_MODE-gated reset AR got in A3. All three agents clear their own prior demo output at run start so demo re-runs regenerate from seed instead of stacking/dedup-skipping.

- **News:** clears demo credit_events (news_monitor_agent) + all demo negative_news rows (all 5 are pipeline/fingerprinted). Verified: regenerates to 5 NEWS_EVENT + 5 negative_news from seed_news (5 rows).
- **SEC:** clears demo credit_events (sec_monitor_agent) + demo sec_filings WHERE accession_number IS NOT NULL (the 2 pipeline rows only). Verified: regenerates 2 events + 2 accession filings from seed_sec_filings (2 rows); the 6 null-accession rows preserved.

Emission in both is gated on a successful working-table insert (News: content_fingerprint dedup; SEC: accession dedup with explicit existing-check + continue), so clearing the working-table pipeline rows — not just credit_events — was required, unlike AR (whose data source is internal, no working table). D0 fully closed.

**New cruft logged (B0-style, not D0):** sec_filings has 6 demo rows with NULL accession_number — pre-pipeline output, not regenerated by seed_sec_filings (which produces only 2 accession-bearing filings). Harmless (preserved by D0's accession guard) but stale. Candidate for a future data-hygiene cleanup, same pattern as the negative_news rows B0 removed. Verify nothing reads them before deleting.

---

## CIA sources rework — DONE (2026-06-17)

Replaced the LLM-generated sources panel with deterministic sources built from fetched data. Fixed three real bugs found along the way:

1. **Sources flake (intermittent empty array)** — sources came from a second LLM call returning JSON that intermittently failed to parse (or truncated at max_tokens=1500), defaulting to empty. Now sources are built in code from the matched credit_events. Also hardened that meta call (now confidence-only): max_tokens 1500→4000, robust brace-isolation JSON extraction, error logging instead of silent catch.

2. **Sources fabrication** — the LLM sometimes invented sources that don't exist (e.g. "NEGATIVE_WATCH from Moody's/Bloomberg" — a fake event type/agent mangled from a real news headline). Deterministic build from real rows makes fabrication impossible.

3. **Systemic mutable-query-builder fallback bug (AUDIT-RELEVANT)** — in the credit_events AND negative_news fetches, a single query object `q` was reused: `await q.or(filter)` (filtered) then `await q` (fallback). PostgREST builders are mutable — `.or()` mutated `q`, so the "fallback" silently re-ran the FILTERED query, never actually unfiltered. Any question with <2 keyword matches got the narrow filtered set instead of the intended top-30. Fixed both via `const baseQuery = () => supabase...` factory (fresh builder per call). invoices/payment fetches use a single await — no bug. **Check this reused-builder pattern anywhere else in an audit.**

**Sources are matched-events-only:** built from `credit_events_matched` (events that genuinely keyword-matched the question, ≥1 match), NOT the unfiltered fallback dump. This fixed q8 (unknown customer "ZyloCorp" was getting 30 fallback events as sources → now ~0-1, passes max_sources:2). Trade-off: sources only come from credit_events, so questions whose signal lives elsewhere may show fewer/no sources. That's honest (no fabrication), and tests were corrected to match:
- **q4 min_sources 2→1**: the old :2 was only ever met by the LLM fabricating a 2nd source; real retrieval = 1 NEWS_EVENT matching "negative".
- **q7 min_sources 1→0**: "Has Boeing had SEC filings?" — Boeing has 0 filings, so the honest answer cites 0 sources. Requiring ≥1 would force fabrication. Tests got MORE honest, not weaker.

**Minor refinements logged (not blocking):**
- Generic words like "customer" survive keyword extraction (length>4) and coincidentally match events, adding noise sources (q8 got 1 incidental match on "customer"). Consider a stopword pass for generic terms.
- Sources for thematic questions can be off-theme when matched events span types (a news question's matched set could include non-news events). Acceptable for now; could filter sources by question theme later.
- Sources only derive from credit_events_matched — not sec_filings or negative_news directly. If richer source attribution is wanted (e.g. q7 citing the sec_filings table), extend the builder to those tables.

**Critical context — Anthropic API credits:** several "failures" during this work (HTTP 500 "Failed to generate answer", 0/8 harness runs) were the Anthropic API being OUT OF CREDITS, not code bugs. Credits since topped up. LESSON: the CIA and agents call the Anthropic API at runtime; running the full harness 6× = ~144 API calls and burns credits fast. During development, prefer single-question curls for debugging and run the full harness sparingly (final verification only). DB/migration/data work needs zero API.

---

## B3 — publishEvent run_id passthrough (DEFERRED, but COMMITTED to do — not optional)

**Decision (2026-06-17):** add `run_id` to credit_events so every event traces back to the agent run that produced it. This IS wanted (traceability for debugging + audit) — deferred only on timing, not on whether to do it.

**Why deferred, not done now:** cross-cutting change (schema + publishEvent interface + all three agents pass run_id) with no immediate consumer yet. Best done right before/during the engineer audit, when the trace is actually used.

**Scope when done:**
1. Migration: add nullable `run_id uuid` to credit_events (nullable so historical rows are fine).
2. publishEvent: add optional `run_id` param, write it to the row.
3. Each agent (AR, News, SEC): pass run_id (already created at run start) into every publishEvent call.
4. Verify EVERY publishEvent call site passes run_id (grep all calls — a missed one = silent null, the drift class we keep catching). After wiring, confirm 0 nulls among freshly-emitted demo events.
5. Confirm credit_events.run_id matches the agent_runs row.

**Not blocking anything.** Pick up when the audit is near.

---

## sec_filings 6 null-accession rows — RECLASSIFIED: load-bearing, NOT cruft (won't delete)

**Earlier note (D0) was wrong.** Logged the 6 null-accession demo sec_filings rows as "stale cruft, candidate for cleanup." Investigation (2026-06-17) reversed this:
- The 6 null rows are filing history for **Heliogen, Textron, Triumph**.
- **Textron has ONLY null-accession rows** — deleting them removes Textron from sec_filings entirely.
- Heliogen/Triumph have a pipeline (accession) row PLUS null rows of different filing_types/dates — the nulls are additional history, not duplicates.
- **q7 (CIA harness) reads these** — its correct answer names "Heliogen, Textron, Triumph" as having filings. Deleting would make q7 wrong and likely break the harness.

**Decision: leave them.** They are functional demo content. The only cosmetic issue is the null accession_number, which breaks nothing (D0's accession-not-null reset guard already preserves them correctly).

**Optional future polish (NOT cleanup, low priority):** if accession-number consistency is ever wanted, backfill plausible accessions OR move these into `seed_sec_filings` so they regenerate like the 2 pipeline rows. Demo-data enrichment, not a fix. Do NOT delete.


---

## ticker → customer_identifiers migration (IN PROGRESS — sec_cik done, ticker remains)

**sec_cik: DONE** (migration 20260617224949, commit 356faac). Dropped customers.sec_cik — data already in customer_identifiers (47 cik rows), zero code readers (all .cik reads are sec_filings.cik/sec_monitoring.cik, kept by design), zero view readers.

**ticker: SPEC READY, execution pending.** Full diagnosis done 2026-06-17 so next session is execution-only.

Verified facts:
- Data already in customer_identifiers: 47 ticker rows, all is_primary=true, 0 customers with multiple tickers (clean 1:1 join, no row multiplication; is_primary filter optional but include for correctness).
- ticker REAL readers (everything else is dead selection):
  - CIA: line ~1050 ONLY (briefing-path Teams alert label), fed by the ~855 customers fetch. Lines 359/384/523 select ticker but NEVER read it (context builder ~614-648 doesn't use ticker) — dead selects, remove ticker from those select strings.
  - news-monitor-agent: 5 uses (search-news input + alert labels), fed by line ~134 customers fetch.
  - sec-monitor-agent: 2 uses (~258/261 alert label), fed by its customers fetch.
- 7 views output c.ticker: v_ar_aging_current, v_bankruptcy_claims, v_customers_at_risk, v_growth_opportunities, v_overdue_invoices, v_payment_behaviour, v_sec_monitoring_dashboard. None reference sec_cik.

Design: v_customers_enriched = customers LEFT JOIN customer_identifiers (id_type='ticker' AND is_primary) exposing ticker. Real code readers select from it; views join customer_identifiers for ticker.

Execution steps (dry-run BEGIN/ROLLBACK each):
1. Create v_customers_enriched. Verify 59 rows, 47 with ticker matching old customers.ticker, 12 null.
2. CIA: remove ticker from dead selects (359, 384, 523); repoint the 855 briefing fetch to v_customers_enriched so 1050 still works.
3. news-monitor: repoint line 134 fetch to v_customers_enriched (or add CI join).
4. sec-monitor: repoint its customers fetch likewise.
5. Rewrite the 7 views: c.ticker -> LEFT JOIN customer_identifiers (primary ticker). Paired view-update migration (B5 pattern). Snapshot each view output BEFORE, diff AFTER — prove no behavioral change.
6. Drop customers.ticker.
7. VERIFY (API — once, at end): run all 3 agents in demo (ticker alert labels still populate), CIA harness 8/8.

Risk: G1 two-check. A missed reader = silent NULL ticker in an alert label (cosmetic, not a crash — easy to miss). After the drop, grep .ticker to confirm only v_customers_enriched-backed reads remain. The 12 customers with no ticker (private/invented demo cos) correctly show null — expected, not a bug.

---

## ticker migration — DONE (2026-06-19). G1 lesson upgraded to THREE-check.

customers.ticker + sec_cik both dropped; single source of truth in customer_identifiers. 4 agents cleaned, 7 views repointed, fn_rank_portfolio_risk fixed. Harness 8/8.

**Lesson:** dropping a column needs THREE reader checks, not two:
1. Code: grep .ts for the column / embedded joins.
2. Views: pg_views definitions referencing the column.
3. Functions: pg_proc.prosrc bodies - SELECT proname FROM pg_proc WHERE prosrc ILIKE '%col%'. SQL function bodies do NOT appear in pg_depend as column deps, and ALTER TABLE DROP COLUMN does NOT validate them - so the drop "succeeds" but the function errors at call time. fn_rank_portfolio_risk dead-selected ticker and silently broke q1 until caught. Always run the pg_proc sweep before dropping a column.

---

## Legacy/Lovable cruft cleanup — DONE (2026-06-20)

Full current-tree review for Lovable-era cruft. Removed (all build-verified green):
- database/ dir — stale Lovable schema (had dropped sec_cik/ticker columns), superseded by supabase/migrations/. Only DEVELOPMENT.md referenced it (fixed). ~17K lines (mostly old seed.sql).
- 30 unused shadcn UI components (verified zero imports; kept the ~18 used).
- 3 orphaned pages (ActivityFeed, Demo, Index — not in router).
- 3 orphans (useCIA hook = dead/CIA fetches inline; use-mobile hook = orphaned when sidebar removed; custom NavLink = app uses react-router's).
Commits: 781f11f, 8f28c91. Build green throughout (frontend has no harness — npm run build is the gate).

**Still OPEN (optional, low-value):**
- Unused npm dependencies: removing 30 UI components likely orphaned backing packages (embla-carousel, vaul, cmdk, input-otp, react-resizable-panels, react-day-picker, possibly recharts — VERIFY each, recharts may be used elsewhere). Low value (tree-shaking already excludes from bundle; harmless in package.json), build-fragile, noisy package-lock diff. Do only if pristine package.json wanted. depcheck not installed; npm i -D depcheck then verify each + npm run build before removing.
- README.md (19KB) — confirm it describes current system, not Lovable starter. Quick accuracy pass.

**Repo visibility:** currently PUBLIC. No secrets in git history (verified — only a passwordless pooler-url, since gitignored). For pre-launch, consider making private; at launch, a fresh-start public repo gives clean history without Lovable commits.

---

## CIA Refinement 2 — DONE (2026-06-22, commit 2283cb7)

Sources now include matched negative_news (as NEGATIVE_NEWS) and sec_filings (as filing_type, e.g. 10-Q), mapped into the existing event-shaped source so the frontend renders unchanged. Both use the matched-not-fallback discipline: negative_news_matched only on keyword hit; sec_filings_matched only for filings whose customer is named in the question (the sec_filings fetch is unfiltered top-10, so the intersection prevents over-sourcing). Verified: q4 gains news sources, q7 stays 0 (Boeing has no filings), q8 stays 0 (unknown customer), Triumph filing question shows its 3 dated 10-Qs. Harness 8/8.

**Consciously NOT done:** per-customer filing cap. A customer with many filings would list all as sources. Non-issue at demo scale (max 3 filings/customer). If filing volume grows in production, cap filings-per-customer in the builder. Cross-type duplication (a customer showing both NEWS_EVENT and NEGATIVE_NEWS) kept deliberately — distinct records; dedup only if it reads noisy in the real UI.

---

## Migration baseline rebuild — DONE (2026-06-28 to 2026-07-03)

Old 57-migration chain replaced with a clean schema baseline (`supabase/migrations/00000000000000_baseline.sql`, dumped from live schema — self-contained: pg_trgm, search_path pinned on all 6 functions, trigger calls schema-qualified). Old chain preserved in `supabase/migrations_archive/` (57 files, nothing lost — verified `next_dunning_date` drop migration archived correctly and its effect is reflected in baseline.sql + seed.sql, both confirmed clean via grep). Commit 4a747f8.

Demo seed extracted to `supabase/seed.sql` — schema migrations now schema-only; demo data loads separately (`db push` then optional `psql -f supabase/seed.sql`). Production clones start clean, no purge needed. Commit 0a81332 (README updated to match).

Verified end-to-end on a fresh scratch Supabase project: db push builds clean, seed.sql loads, exposure trigger + fn_rank_portfolio_risk() produce the correct 7 high-risk customers, CIA harness 8/8.

Demo-boundary audit completed as part of this work: all 4 agents confirmed correct (news/sec/ar-aging run the real pipeline in demo, switching only at the fetch point; CIA is intentionally mixed — canned briefing/suggestions in demo, live question-mode on haiku). DEMO_MODE.md rewritten (b6848ff) to match; the old doc described the superseded pre-baked-bypass model.

CLI unlinked from the demo project (was silently linked to a demo Supabase project ref — a bare `db push` would have hit it). No default push target now.

**Still open from this session:**
- Delete the throwaway scratch Supabase project used for verification (project ref umbbhniobhcghopcxyfh) — testing done, password was pasted in a chat so deletion moots exposure, but not yet deleted.
- E1 (dev DB password rotation) — status not confirmed this session; verify.
- The search_path fix lives only in the baseline — if functions are ever regenerated from the archived migration chain, they'd lose it. Non-issue unless someone un-baselines.
- is_demo coverage still incomplete (not on `customers` or `ar_aging_snapshots`) — only matters if a true one-command demo-purge is wanted later.

## AR-Aging agent audit — upload path (2026-07-08)

Audited the never-verified real-upload path (ar-csv-upload -> parse-ar-csv -> invoices -> agent) per the flagged handoff gap. Found and fixed three bugs, all verified end-to-end with a real test upload against Bloom Energy Corporation (customer c0000001-0000-0000-0000-000000000047):

1. **CRITICAL — every real upload was failing.** ar-csv-upload wrote to `paid_amount`, a column dropped in B0 Phase 3 (only `amount_paid` remains). Every CSV upload since that migration returned a hard insert error. Fixed: renamed to `amount_paid`. Commit c106005.

2. **Snapshots never refreshed after upload.** ar_aging_snapshots (and v_ar_aging_current, which the AR agent reads) was never refreshed after invoice insert — current_exposure updated via trigger, but snapshots/buckets/utilization_pct stayed stale until someone manually ran fn_refresh_all_ar_aging. Real uploaded data was invisible to the AR agent indefinitely. Fixed: ar-csv-upload now calls fn_refresh_ar_aging per matched customer after insert. Commit 2075aca.

3. **Swallowed error on customer lookup.** The `.ilike(company_name)` lookup destructured only `data`, never `error` — an ambiguous match would silently land in unmatched_customers with no diagnostic. Fixed: error now destructured and logged. Commit 2075aca.

Verified via live test upload + psql snapshot diff (before/after) + bucket-level reconciliation (invoice with days_overdue=38 correctly landed in bucket_31_60). Test data cleaned up after (invoice deleted, snapshot re-refreshed to baseline).

**Still open — Gap B (next):** customer lookup is name-only (`.ilike`, exact case-insensitive match, not true fuzzy). Does not use `customer_identifiers` (DUNS/ticker/CIK/LEI/internal_code) at all, despite the locked Identifier Strategy doc specifying that precedence. This is the next task.

---

## AR-Aging upload — identifier-based customer matching (Gap B) — DONE (2026-07-08)

Replaced name-only (.ilike company_name) customer matching in ar-csv-upload with identifier-based lookup per the locked Identifier Strategy doc. Precedence: duns -> internal_customer_code -> reject (no fuzzy name fallback; uploads without a resolvable identifier are rejected outright with a clear reason).

Prerequisite: internal_customer_code was empty for all 59 customers (duns also empty — no real DUNS data available). Backfilled internal_customer_code as CUST-001..CUST-059 (alphabetical by company_name), seeded in supabase/seed.sql (commit aa194f9) so it's reproducible on a fresh DB. DUNS intentionally left unpopulated (would require real external D&B registry numbers).

Changes:
- parse-ar-csv.ts: added optional duns / internal_customer_code CSV columns with header aliases (commit 46fe32a).
- ar-csv-upload/index.ts: batch-fetch customer_identifiers by duns and internal_customer_code (2 queries, not N), resolve each row with duns-first/internal_customer_code-fallback precedence, reject with per-row reason ({ customer_name, reason }) instead of a flat unmatched string array (commit 6e76a40).

Verified live (not just deployed): old-style name-only CSV correctly rejected with reason "no identifier provided"; CSV with valid internal_customer_code correctly matched, inserted, and triggered a correct snapshot refresh (bucket placement verified). Test data cleaned up after, snapshot confirmed back to baseline.

**Still open:** ticker/cik/lei are not used in upload matching (by design — those identify public-market/regulatory identity, not invoice-upload identity; only duns + internal_customer_code are relevant here). If a customer later needs to upload using DUNS, it must be added to customer_identifiers first (no upload flow exists yet to self-register a new identifier — out of scope, matches V1's "no auto-creation" rule in the Identifier Strategy doc).

---

## F2 — RESOLVED (2026-07-12): fn_refresh_ar_aging date bucketing + demo re-anchor

Root cause confirmed: fn_refresh_ar_aging bucketed by the stored invoices.days_overdue column instead of computing (p_as_of - due_date) live. p_as_of was only ever used as the snapshot's date label -- it never affected which bucket an invoice landed in. This meant snapshots never reflected the passage of real time; a customer's aging only updated when something rewrote days_overdue (e.g. a CSV re-upload).

This is a real production correctness gap, not just a demo cosmetic issue -- confirmed live on Bloom Energy before fixing: a $980K invoice correctly due and unpaid showed as bucket "current" when it was actually 90+ days overdue by real calendar time.

Fixed in two parts, verified together:

1. **fn_refresh_ar_aging rewritten** to bucket by (p_as_of - due_date) computed live, matching the CHECK/status guards already in place (migration 20260712000000, also applied directly to the baseline so a fresh db push includes the fix). Commit 3db0dfe.

2. **One-time demo invoice date re-anchor.** Fixing the function alone, without re-anchoring data, would have made the demo portfolio look catastrophically broken: dry-run showed $68.5M of $77.9M jumping into bucket_over_90 and current_amount going to $0, because the demo's due_dates were seeded assuming "today" was mid-2026 and the calendar has since moved past that. Applied a precise per-invoice shift: due_date and invoice_date both shifted by (CURRENT_DATE - (due_date + days_overdue)) for every non-pre_petition, non-paid/written-off invoice (132 rows) -- this reproduces each invoice's exact previously-stored days_overdue when recomputed live, so every customer's demo narrative (Rite Aid bankrupt, McDermott deteriorating, etc.) is preserved exactly, just re-anchored to today's date. Verified: post-fix portfolio bucket totals (62,262,000 / 7,305,000 / 6,505,000 / 1,825,000 / 0 current-through-over_90, 77,897,000 total) exactly match the original healthy pre-bug distribution. current_exposure unaffected (unrelated trigger). Applied directly via psql (data, not schema) -- not captured in a migration since it's a one-time data correction, not a repeatable schema change.

Harness 8/8 after both changes.

**Still open (new, surfaced during this fix):** the *stored* `invoices.days_overdue` column itself has the same class of staleness problem -- it's computed once at upload time and never passively recomputed as calendar time passes. Unlike ar_aging_snapshots (now fixed to compute live), anything that reads invoices.days_overdue directly (not through fn_refresh_ar_aging) -- e.g. the CIA answering direct invoice questions -- will still see stale values between uploads. This needs either (a) a scheduled job that recomputes days_overdue for all open/overdue invoices periodically, or (b) callers computing it live from due_date instead of trusting the stored column, same fix pattern as this one. Logging as new backlog item, not fixing today -- out of scope for this pass, which was specifically the ar_aging_snapshots/bucketing correctness.

---

## next_dunning_date drop — CONFIRMED CLEAN (verified 2026-07-03)

`invoices.next_dunning_date` was dropped 2026-06-06 (migration `20260605150000_b0_drop_next_dunning_date.sql`, now in migrations_archive/ after the baseline rebuild) alongside the `v_overdue_invoices` rewrite. This was flagged in the B0 plan's Phase 1d follow-up list as an unaudited column; confirmed during backlog review that it's genuinely gone (not referenced in baseline.sql or seed.sql) and the drop was clean.

---

## CIA agent invoices fetch — days_overdue staleness fix + new scoping bug found (2026-07-22)

Extended the F2/OVERDUE_AR fix pattern to cia-agent's direct invoices fetch (fetchRelevantData, ~line 464). Same root cause: query ordered/filtered by the stale stored days_overdue column instead of live due_date, and the raw stored value was passed through unchanged into the CIA's answer context.

Fixed: query now orders by due_date ascending and filters .lt("due_date", todayStr) instead of using days_overdue; the mapping now computes days_overdue live from due_date before it reaches the template string that formats invoices into the CIA's context. Commit 181893a.

Verified the code pattern matches the already-proven-correct ar-aging-agent fix (same live-due_date-computation approach). Direct verification via CIA question/answer proved inconclusive/expensive -- the LLM's answer phrasing varied run to run (sometimes citing the OVERDUE_AR aggregate instead of enumerating raw invoice rows, sometimes claiming data "wasn't available" for a customer whose data was actually present) -- this is a formatting/prompt-following characteristic of the LLM's answer construction, not evidence of a code defect. Confidence in the fix rests on the structural code match to the already-verified ar-aging-agent case rather than a clean end-to-end CIA answer trace. Harness 8/8 after the change.

**New bug found during verification (separate from the days_overdue fix, not fixed today):** the invoices-fetch closure in cia-agent resolves `custIds` (which customer(s) the question is about) by matching question words against only the FIRST 20 customers (`supabase.from("customers").select(...).limit(20)`, no filter), not by searching the full customer table for a name match. If the named customer isn't among those first 20 (by default id ordering), custIds stays empty and the code silently falls back to the global oldest-20-invoices-overall branch -- meaning the CIA can answer confidently about the wrong (or incomplete) set of invoices for any customer outside that arbitrary first-20 window, without any error or signal that this happened. Confirmed live: "Orbital Energy Group Inc" is not in the first 20 customers by id order, and a direct question about their specific invoice returned "does not appear in the invoices table" even though the invoice was present and was in fact the single oldest overdue invoice in the whole portfolio.

**Fix needed (not done today):** the customers fetch in this closure should filter by the extracted question words directly (e.g. .or() with ilike on company_name for each word) instead of fetching an arbitrary first-20 and filtering client-side. Same class of fix as the identifier-matching precision work done elsewhere this session -- don't silently narrow to an arbitrary subset when a targeted query is possible. Worth checking whether the same first-20-then-filter pattern exists elsewhere in cia-agent's other table-fetch closures (customers used for context, payment_transactions, etc.) -- this may not be isolated to invoices.

**UPDATE (same day) — custIds scoping bug FIXED, and the days_overdue fix now directly confirmed.** Fixed both the invoices and payment_transactions closures: replaced the broken "fetch first 20 customers, filter client-side" lookup with a targeted .or(nameFilter) query (matching the pattern already correctly used in the customers closure), and customerMap is now derived from the actual result set's customer_ids instead of an arbitrary pre-fetch. Commit d828168.

Direct SQL verification (bypassing the LLM, which had been giving inconsistent answers about whether data was "available") confirms both fixes work correctly: querying invoices for the 11 customers matching a broad name-search ("Orbital Energy Group Inc" matches on "Energy"/"Group") returns Orbital's 3 real invoices, including INV-OEG-2024-0189 (previously invisible under the old first-20 bug), correctly ordered by due_date. The earlier "inconclusive" LLM-based verification is superseded -- the underlying fix is confirmed correct at the data layer. The CIA's occasional preference for summarizing via the OVERDUE_AR aggregate instead of enumerating raw invoice rows in prose (seen during testing) is a separate, lower-priority prompt/formatting characteristic, not a data-fetching defect -- logging as a minor follow-up, not fixing today.

**New minor note surfaced during verification:** broad name-word matching (e.g. "Group", "Energy") can match many customers at once when a company name contains common words -- this is correct/expected behavior (the .or(nameFilter) approach intentionally matches on each capitalized word), but worth knowing: a question naming one company can pull in several similarly-named companies' data into the same 20-row invoice fetch. Not a bug (data is real and correctly attributed per row), just a precision characteristic -- same trade-off the customers closure above it already accepts.

---

## LLM aggregate-vs-detail prose issue — RESOLVED, but real root cause was different (2026-07-25)

Investigated the "LLM prefers aggregate OVERDUE_AR summary over enumerating individual invoices" issue logged earlier. Initial hypothesis (prompt's 120-word cap forcing summarization) was real and fixed, but turned out to be the SECOND of two compounding causes -- the first and primary cause was a data-filtering bug that made the raw invoice data invisible to the LLM entirely, regardless of prompt wording.

**Root cause 1 (primary, found via direct SQL debugging after three straight failed prompt-based tests):** cia-agent's invoices closure filtered `.eq("is_demo", demoMode)`. This table's is_demo tagging is not reliable or consistent -- confirmed the original seed data itself has a genuine mix (108 invoices is_demo=false, 52 true, including clearly original hand-seeded invoices like Boeing's INV-BA-2024-0891 tagged false). ar-aging-agent already treats this correctly: it never filters invoices by is_demo (only stamps its output *events* with it), because invoices.is_demo isn't a meaningful signal in this dataset. cia-agent's invoices fetch disagreed with that and silently excluded any invoice whose is_demo didn't match the deployed DEMO_MODE value -- meaning entire customers' invoice data could vanish from CIA answers with no error, no signal, just "I don't have that information," which reads as a data-completeness statement but was actually a filtering bug. Fixed by removing the filter from the invoices query, matching ar-aging-agent's treatment. Commit f132c5f.

**Root cause 2 (prompt cap, real but secondary):** system prompt's 120-word response cap gave the model no room to enumerate multiple invoices with citations, so it defaulted to citing the OVERDUE_AR aggregate event instead. Fixed with an explicit exception clause: enumerate/list questions may exceed 120 words and should pull from raw table data, capped at 15 items with a total-count note if more exist. Commit 1d9b23a.

**Verified together:** "List every individual overdue invoice for Orbital Energy Group Inc with its exact invoice number and exact days overdue" now correctly returns all 3 real invoice numbers, real amounts, and days-overdue computed live from due_date (97/77/20 days) -- previously failed the same way on this exact question across 4 consecutive attempts before both fixes landed. The model's confidence_reason on the successful run correctly flagged a data-freshness discrepancy between the OVERDUE_AR event (generated 2026-07-21, showing 93 days) and the live invoices computation (2026-07-25, showing 97 days) -- this is expected/correct behavior post-fix (the event is a point-in-time snapshot; the invoices fetch is now live), not a new bug. Harness 8/8.

**Lesson for future is_demo-related work:** is_demo is not applied consistently across all tables in this system (customers has no is_demo column at all; invoices has one but it doesn't cleanly separate anything meaningful in current data; credit_events/negative_news/sec_filings use it properly as an agent-output separator). Before adding or trusting an is_demo filter on any query, verify what that table's is_demo values actually represent for the data being queried -- don't assume symmetry across tables.

---

## Phase 1d — sec_monitoring coverage expansion + data integrity fix (2026-07-26 to 2026-07-28)

**Coverage gap found and fixed.** sec_monitoring only had 3 of 47 CIK-holding customers monitored (Boeing, Lockheed, Raytheon, and 41 others with valid CIKs were never being watched for SEC filings at all). Backfilled all 47 via seed.sql (commit 6194847), sourcing from customer_identifiers (id_type='cik'). Verified live: triggering the agent correctly picked up newly-added customers (Howmet, American Airlines, Boeing, Curtiss-Wright, GE Power, Haynes, HEICO, Kaman, Orbital Energy, Ducommun in one run) and processed them without error.

**Data-loss incident during verification, fully recovered.** The verification run's DEMO_MODE-gated reset (existing D0 behavior, working as designed) cleared ALL demo accession-numbered sec_filings + their credit_events at run start, but the run only processes 10 customers/invocation -- meaning Heliogen and Triumph's real pipeline filings + GOING_CONCERN/SEC_OTHER events (previously reclassified in this backlog as "load-bearing, not cruft") were wiped and would not have regenerated for several more run-cycles given the new 47-customer pool. Recovered by temporarily setting is_demo=false on the other 45 rows (isolating Heliogen+Triumph so a real agent run would target exactly them), running the agent once (correctly regenerated both filings with original accession numbers + both events), then restoring is_demo=true on all 47. Verified filings/events match originals exactly. Harness 8/8 throughout.

**Lesson:** DEMO_MODE=true is correctly set on the one production Supabase project (yxqudytimmxufypothis) because it IS the live public demo (creditpilot.vercel.app) -- this is by design, not a misconfiguration. Any future live testing against write-triggering endpoints (agent invocations) on this project should account for demo-reset side effects; consider standing up a scratch project again for testing that could trigger resets, rather than testing directly against the public demo.

**Separate data-integrity bug found and fixed, root cause NOT fully confirmed.** All 45 non-original sec_monitoring rows showed alert_triggered=true despite empty risk_signals_detected and null alert_date -- an internally inconsistent state (no agent run ever processed most of these 45 customers per agent_runs history; no trigger or rule exists on the table; a fresh isolated test insert with the same column pattern correctly produces alert_triggered=false). The exact mechanism that set alert_triggered=true was not conclusively identified despite checking triggers, rules, agent update logic, and this session's own SQL commands. Corrected the data directly (UPDATE ... SET alert_triggered=false WHERE alert_triggered=true AND risk_signals_detected is empty AND alert_date IS NULL -- affected exactly 45 rows, left Heliogen+Triumph's 2 legitimate alerts untouched). Flagging as unresolved-root-cause for awareness: if this recurs, it needs a live reproduction to catch in the act (e.g. watch pg activity during a bulk insert), since post-hoc investigation could not pin it down.

**Non-issues confirmed during investigation (documenting so they aren't re-investigated):**
- CIK accuracy: spot-checked Howmet Aerospace (CIK 4281 -- unusually low because it retained Alcoa's original CIK from the 2020 spinoff) and Moog Inc (CIK 67887) against live SEC EDGAR data. Both correct. The "wrong company" appearance reported was actually the alert_triggered bug above making the page look chaotic, not bad CIK data.
- Sidebar SEC Filings badge ("2"): not a bug. Counts sec_filings WHERE reviewed=false -- reviewed is part of the never-implemented hand-review workflow (already logged elsewhere in this backlog as unused workflow cruft), always false, so the badge just shows the total demo filing count. Cosmetically looks like an unread-notification count but isn't one.

**bankruptcy_details and growth_signals: confirmed fully dead code+schema.** No agent, no frontend page, no view actually in use, and cia-agent's dynamic table router never selects them. 4 and 5 rows of orphaned original seed data respectively. Not fixed (nothing broken, just unused) -- candidate for the same future schema-hygiene cleanup pass as other cruft columns already logged (flags, dso_days, etc.), not urgent.

## Frontend column-drift audit (2026-07-28) — critical live-site bug found

**CRITICAL, confirmed live for weeks: the public demo (creditpilot.vercel.app) was blank with zero visible events.** Root cause: 6 frontend pages (Actions, ArAging, CreditEvents, NewsMonitor, SecFilings -- via embedded PostgREST selects like customers(company_name, ticker) -- plus Customers.tsx via direct display) still referenced customers.ticker, which was dropped from the customers table during the ticker migration (commit 1205e23, weeks prior) and moved into customer_identifiers. The embedded selects caused hard 400 errors on the primary data queries for 5 of the 6 pages, making them appear completely blank. This was never caught because the backend column-drop process (G1/G1-three-check discipline: code + views + function bodies) was never extended to the src/ frontend directory -- a real gap in that lesson's scope.

Fixed: removed ticker from all embedded selects and all display JSX across Actions.tsx, ArAging.tsx, CreditEvents.tsx, Customers.tsx, NewsMonitor.tsx, SecFilings.tsx (commit bbbd0db). This is a permanent fix, not a stopgap -- ticker was never a meaningful field to show given most customers are private companies without one; trade-credit identity is properly DUNS/internal-code based per the locked Identifier Strategy doc, not ticker.

**Follow-up sweep found 3 more silent (non-crashing but wrong-data) bugs from the same root cause class**, all fixed in commit 6bb488e:
- ArAging.tsx: dso_days column (dropped in B0) always silently displayed as 0. Removed the column from the table entirely (matches Demo Data Contract: "compute at read time if ever needed" -- nothing computes it currently).
- Customers.tsx: customers.flags (dropped in B5) always silently rendered as an empty "Manual Tags" section. Removed the dead UI section entirely.
- Customers.tsx: invoices.paid_amount (dropped, only amount_paid remains) caused every invoice's "Paid" amount to silently display as $0 regardless of actual payment status -- a real correctness bug a credit manager could have acted on incorrectly. Fixed to read amount_paid.

**Full frontend query sweep completed after these fixes** -- every .select() call across all 6+ pages checked column-by-column against the live schema (customers, invoices, credit_events, pending_actions, sec_monitoring). No further stale-column references found.

**Process gap to close:** the G1 lesson (backlog, three-check rule for column drops: code + views + function bodies) needs a fourth check added -- frontend (src/) queries, both embedded PostgREST selects and direct field access in JSX. This was the actual root cause of the biggest bug found this entire pre-audit pass. Update the G1 note itself to reflect this.

---

## Frontend days_overdue staleness — final instance fixed (2026-07-30)

Found during a pre-audit "what's left" review: Customers.tsx's per-invoice detail view (Invoices tab) still read the stale stored invoices.days_overdue column directly for both its color-coding and its "Xd overdue" display text -- the same staleness bug already fixed this session in ar-aging-agent's OVERDUE_AR emission and cia-agent's invoice fetch, but missed in the earlier full frontend sweep since this specific display wasn't caught by the grep patterns used at the time (it read inv.days_overdue as a property access, not as part of a query select string).

Fixed: computes days-overdue live from due_date (paid/written_off invoices correctly excluded from aging math, matching the same convention used elsewhere). Build verified clean. Commit 6c5a940.

This closes out the last known instance of this specific bug class across the codebase (backend agents + all frontend consumers now verified to compute live rather than trust the stored column).

---

## Invoice status badge staleness — found via user review, fixed (2026-07-31)

Found while reviewing the just-deployed days_overdue live-fix on the Customers page: two invoices displayed a visible contradiction -- a "current" status badge sitting directly next to "19d overdue" text on the same card. Root cause: the previous fix made days_overdue compute live from due_date, but the status badge still read the stored invoices.status column directly -- the same staleness bug, just on a sibling field, and the mismatch between a now-live field and a still-stale field made the inconsistency visible for the first time (previously both were consistently wrong together).

Fixed: added liveStatus, computed the same way as liveDaysOverdue -- overrides only between "current" and "overdue" based on the live date; any other status (paid, written_off, disputed, pre_petition) passes through untouched since those aren't date-driven states. Matches the documented status-derivation rule in the Input Contract doc. Build verified clean. Commit 466ed93.

**Also noted, not yet investigated:** the Activity tab on this same customer detail view shows a "DUNNING LETTER STAGE 1" entry attributed to ar_aging_agent, dated Mar 3. Confirmed elsewhere this session that dunning letter composition is NOT currently wired into ar-aging-agent (zero code references) -- this is almost certainly old seed/demo activity data from before that wiring was removed, not a live capability. Low priority (doesn't affect correctness of current data, just could mislead someone into thinking dunning letters are actively sent today) -- worth a quick look whenever the dunning feature work is picked back up, to confirm this seed row is clearly historical/demo-narrative and not accidentally implying current behavior.

---

## sec_monitoring alert_triggered bug — ACTUAL root cause found (2026-07-31)

Earlier this session (Phase 1d), this same bug was found and data-corrected, but its root cause was explicitly flagged as unresolved. It recurred today -- confirmed via a live screenshot showing all 47 monitored customers with "Alert Active" -- proving it was a real, reproducible code bug, not a one-time manual mistake.

**Real root cause found:** src/lib/initDemo.ts contained an unconditional `UPDATE sec_monitoring SET alert_triggered = true WHERE is_demo = true`, run on every demo init (page load / Reset Demo click). This was written when sec_monitoring only had 3 monitored customers (Heliogen, Triumph, Textron) -- forcing "alert active" made sense then as a demo-repeatability mechanism. It was never revisited when sec_monitoring was expanded to 47 customers earlier this session (the coverage-expansion work), so it silently corrupted every one of the 44 newly-added customers' alert state on every single page load from that point on -- explaining why the manual data fix from Phase 1d didn't hold.

Fixed: removed the blanket update entirely (commit 1db03aa). Safe to remove -- Heliogen and Triumph's genuine alert_triggered=true is baked directly into seed.sql, not dependent on this runtime reset. Also fixed a related pre-existing inconsistency found while investigating: Textron's own seed.sql row had alert_triggered=true despite empty risk_signals and no alert_date (same inconsistent-alert pattern) -- corrected directly in seed data (commit dad24b4) so a fresh database load won't reintroduce it. Live bad data re-corrected via the same UPDATE query as the original Phase 1d fix. Harness 8/8.

**Lesson:** when expanding a table's scope (3 -> 47 monitored customers), grep for every write path touching that table, not just the ones in the agent that reads/processes it -- this bug lived in a completely different file (initDemo.ts) with no obvious connection to the sec-monitor-agent code that was actually audited during the coverage-expansion work.

## Misleading SEC Filings sidebar badge — removed (2026-07-31)

Found while investigating the above: the "2" badge next to SEC Filings in the sidebar was not a real notification count. It counted sec_filings WHERE reviewed=false -- reviewed is part of a hand-review workflow that was never built (already documented elsewhere in this backlog as unused workflow cruft), so the badge always showed the total demo filing count, not genuinely unread items. Removed entirely (commit ae665cf), along with a related fully-dead "news" badge count that was computed but never displayed anywhere (News Monitor never had a badgeKey to show it).

---

## CIK data quality audit — 27 of 47 monitored companies had wrong CIKs (2026-08-01)

Triggered by user review: clicked "View SEC Filings" for Spirit Airlines and landed on Morningstar, Inc.'s real EDGAR page instead. Investigation found this was not an isolated error or a link-construction bug (the generated URL and link logic were confirmed correct) -- the underlying CIK value stored for Spirit Airlines (0001289419) was simply wrong; it happens to be Morningstar's real, valid CIK.

Given one wrong CIK was found immediately, did a full verification pass across all 47 monitored companies against live SEC EDGAR data (cross-referenced against SEC's official company_tickers.json bulk file plus individual EDGAR searches for companies not in that file). Result: **27 of 47 (57%) had wrong CIKs.** Several pointed to entirely unrelated real companies: Spirit Airlines -> Morningstar, Haynes International -> Hasbro, Precision Castparts -> PPG Industries, Yellow Corporation -> MYR Group. Most others were near-miss transpositions/typos of the correct CIK (e.g. Lockheed Martin 936395 vs real 936468, Curtiss-Wright 26535 vs real 26324) -- consistent with manual transcription errors during original seeding, not a systematic generation bug.

20 of 47 were confirmed correct: AECOM, Baker Hughes, Bloom Energy, Chart Industries, Ducommun, HEICO, Heliogen, Howmet, Huntington Ingalls, Kaman, Moog, Parker Hannifin, Rite Aid, Spirit AeroSystems, Superior Industries, Textron, Boeing, TransDigm, Triumph Group, Woodward.

Fixed: all 27 corrected in customer_identifiers (source of truth) -- live database (commit via direct SQL, verified with dry-run/commit pattern) and supabase/seed.sql (commit 508e4ac), so the fix persists on a fresh database load. sec_monitoring did not need separate correction -- its rows for these 27 companies are generated dynamically from customer_identifiers on load, not stored as independent seed values. Harness 8/8 throughout.

**Full list of corrections (company: wrong CIK -> correct CIK):**
American Airlines Group: 0000004515 -> 0000006201
Archer Aviation: 0001779128 -> 0001824502
Arconic Corporation: 0001790420 -> 0001790982
CIRCOR International: 0001060349 -> 0001091883
Coeur Mining: 0000215243 -> 0000215466
Curtiss-Wright: 0000026535 -> 0000026324
GE Vernova: 0002013928 -> 0001996810
GE (Power segment): 0000040534 -> 0000040545
Global Power Equipment Group: 0001282266 -> 0001136294
Haynes International: 0000046080 -> 0000858655
Joby Aviation: 0001724570 -> 0001819848
Leonardo DRS: 0001675644 -> 0001833756
Liqtech International: 0001307950 -> 0001307579
Lockheed Martin: 0000936395 -> 0000936468
Maxar Technologies: 0001802665 -> 0001121142
McDermott International: 0000854422 -> 0000708819
Mistras Group: 0001436523 -> 0001436126
Orbital Energy Group: 0000060714 -> 0001108967
Precision Castparts: 0000079879 -> 0000079958
ProPetro Holding: 0001681903 -> 0001680247
Proterra: 0001816810 -> 0001820630
Ranger Energy Services: 0001679363 -> 0001699039
Raytheon/RTX: 0000101830 -> 0000101829
Spirit Airlines: 0001289419 -> 0001498710
Vertex Energy: 0001396033 -> 0000890447
Watts Water Technologies: 0001410172 -> 0000795403
Yellow Corporation: 0000700923 -> 0000716006

**Lesson:** this confirms the same class of issue as the original Heliogen CIK error that motivated building customer_identifiers in the first place -- but at far larger scale than previously known. The B-prime backlog item's planned "full CIK-vs-EDGAR verification pass across all customers" (referenced multiple times as intended work) either never actually ran, or ran and its results were never applied. This pass should be considered done now for the 47 currently-monitored companies, but the same verification should be applied to any customer identifiers added in the future (e.g. once DUNS backfill happens) rather than assuming manually-entered demo data is correct without checking.

**Explicitly deferred:** DUNS backfill for all 59 customers -- user will source this manually, post-audit, separate task from this CIK correction.

---

## CIA demo/production design + critical source-click-through bug (2026-08-03)

**Demo cost/quality design.** Discussed whether live question-mode in demo (already capped at 5 questions/visitor, cheapest model) needed further cost control. Decided against reducing it -- the existing cap is reasonable -- but improved quality control instead: the 4 suggested questions now serve pre-generated real answers (captured live from the actual pipeline this session, after this session's CIK corrections, so the underlying data was as clean as it's been) instead of hitting the live API every time. Zero cost, zero risk of an unpredictable/embarrassing answer for the most common demo interaction, while genuine free-text search stays fully live and capped as before. Answers stored in src/lib/demoAnswers.ts, wired into CIA.tsx's question flow (commit 50c9acb) -- checked before the live API call, does not count against the 5-question limit.

**Critical bug found and fixed: CIA source cards have never actually linked anywhere.** Discovered while building the static demo answers -- Claude Code correctly refused to fabricate event_id values, which surfaced that the live backend never populated event_id in the sources array at all (the type declaration never included it), and separately that 2 of the 3 destination pages (NewsMonitor.tsx, SecFilings.tsx) never read any URL query parameter to begin with. Clicking a source card in the live CIA has likely never worked correctly since the feature was built.

Fixed properly, not just patched: backend now includes event_id (and a new source_type field distinguishing credit_events/negative_news/sec_filings) in every source. Frontend routes each source type to the correct page: credit_events -> /events, negative_news -> /news, sec_filings -> /sec (using customer_id, not the filing's own id, since SecFilings.tsx renders one card per company from sec_monitoring, not one per filing -- a structural mismatch that would have broken even a naive id-based fix). All three destination pages now highlight and scroll to the matching record. Commits 1fa3a12, 6956167.

**Also fixed:** the CIA answer page previously rendered nothing at all when an answer had zero sources (the honest case where an answer is grounded in customers-table data rather than a specific event) -- looked identical to something broken. Now shows an explanatory note instead. Commit 506c805.

**Also fixed:** the CreditEvents.tsx half of the original source-click fix was built but never actually committed in an earlier step this session -- caught during a later diff review, folded into commit 6956167.

Harness 8/8 throughout. Full build verified clean at each step.

---

## Related-question production characteristic + one more instance of the live-status bug (2026-08-03)

**Product design note (not a bug):** related/follow-up questions are generated by a third, separate Claude call fed only the answer text (first 500 chars) -- it has no awareness of what data the system actually tracks. This means both demo and production will occasionally surface a follow-up question that leads to an honest "I don't have that information" answer. Decided this is acceptable and correct behavior for production (never fabricating is the right tradeoff) -- not something to fix. For the demo's 4 frozen static answers specifically, curated their relatedQuestions by testing each against the live system, since a bad follow-up as someone's very first CIA interaction is a worse experience than in ordinary live use. Swapped one weak Triumph Group question (forward-looking liquidity guidance, not tracked) for a verified-good one (overdue invoice detail). Commit 9ddfc48. This curation only affects src/lib/demoAnswers.ts (frontend-only, DEMO_MODE-gated) -- zero effect on production's live related-question generation.

**Real bug found via that testing: cia-agent's invoices fetch had status the same staleness gap already fixed for days_overdue.** Earlier this session (commit 181893a), the invoices closure was fixed to compute days_overdue live from due_date -- but the fix only overrode that one field; the stale stored status column still passed through unchanged. Surfaced concretely: Triumph Group's invoice TGI-2026-0119 correctly computed as 27 days overdue, but its stored status was still 'current' (never recomputed since upload) -- causing the CIA to exclude it from an "overdue invoices" answer while a separate correctly-computed OVERDUE_AR event counted 3 invoices/$1.1M. The CIA itself caught and flagged this contradiction honestly (dropped to Medium confidence, explicitly noted the discrepancy) rather than picking one number silently -- direct evidence the no-fabrication design is working, and how it surfaced this bug in the first place.

Fixed: added the same liveStatus computation already used in Customers.tsx (only overrides current/overdue based on live date; paid/written_off/disputed/pre_petition pass through untouched). Commit 30df3f2. Verified live: re-running the same question now correctly shows all 3 invoices totaling $1,100,000, exactly matching the OVERDUE_AR event, no more discrepancy or hedged confidence. Harness 8/8.

**Lesson, reinforcing G1/G1-three-check:** when fixing a live-vs-stored staleness bug on a row that has BOTH a status field and a days-derived field (invoices has both status and days_overdue, both driven by the same due_date), fixing one without checking for sibling stale fields on the same row leaves a partial, still-buggy state. Worth a final sweep: grep for any other place reading invoices.status directly without the same live-recompute treatment (this session found and fixed it in cia-agent and Customers.tsx; worth confirming ar-aging-agent's own status reads, if any, don't have the same gap -- not checked this session).

Checked (2026-08-08): ar-aging-agent does NOT have this gap -- its overdue filtering (.not("status", "in", "(paid,written_off,pre_petition)")) only excludes terminal statuses and never relies on distinguishing current vs overdue specifically; actual overdue-ness is determined purely from due_date (already fixed earlier this session), so there's no stale current/overdue status dependency to fix here. This closes out the sweep -- cia-agent and Customers.tsx were the only two places with the bug, both now fixed.

---

## Source relevance bug — generic corporate-suffix words polluting matches (2026-08-09)

Found via live user testing: "Any news on Triumph Group?" returned 15 sources, only 4 actually about Triumph Group -- the other 11 were unrelated companies (Orbital Energy Group, Nordam Group, Mistras Group, American Airlines Group, TransDigm Group, etc.) that happened to be high-severity events. Root cause: the credit_events keyword-matching stoplist (KEYWORD_STOPLIST) was designed to filter generic question-scaffolding words ("customer", "portfolio", "recent") but never accounted for common corporate-entity-name suffixes. "Group" alone matched 14 of the demo's ~20-30 credit_events (confirmed via direct query), since many demo company names end in "Group Inc"/"Group LLC".

Fixed: added group, corporation, incorporated, holdings, holding, industries, international, systems, technologies, solutions to KEYWORD_STOPLIST (company/companies were already present). Commit 9d8cc0b. Verified live: the same question now returns exactly 4 sources, all genuinely Triumph Group. Harness 8/8.

**Note for future coverage:** other generic suffixes not yet added (e.g. "enterprises", "partners", "group's" possessive form, "ltd", "inc", "llc" -- though the latter three are likely already filtered by the length>4 rule) could cause similar issues for company names not yet tested. Add to KEYWORD_STOPLIST as encountered rather than trying to enumerate exhaustively now.

---

## Deno type-check audit — all 5 edge functions, completed (2026-08-09)

Ran `deno check` against every edge function's entry point (ar-aging-agent, news-monitor-agent, sec-monitor-agent, cia-agent, ar-csv-upload) -- the last unfinished item from this session's systematic four-part audit plan (column-drop audit, table audit, live click-through, and this).

ar-aging-agent, cia-agent, ar-csv-upload: clean, zero errors, no changes needed.

news-monitor-agent: 29 reported errors, all traced to a single root cause -- legacyPath's `supabase: ReturnType<typeof createClient>` parameter type, a known TypeScript generic-inference edge case (ReturnType on a generic function without explicit type arguments can resolve inconsistently). Zero runtime impact (Deno strips types before execution) -- confirmed the fix (changing to `any`, matching this codebase's existing loose Supabase-typing convention) resolved all 29 errors in one line change. Commit 63a4272.

sec-monitor-agent: 1 error -- `row.customers as { company_name: string }` type assertion failed because TypeScript's generated type inferred the embedded relation as an array, while runtime (confirmed via extensive live testing throughout this session) returns a single object for this to-one relationship. Changed to `any`, same convention. Commit 1927d9d.

Harness 8/8 after both fixes. This completes the planned four-part audit (column-drop sweep, table audit, live click-through, Deno type-check) -- all four came back clean or with issues found-and-fixed, no unresolved findings remaining from that plan.

---

## Ticker data-quality verification — clean, no corrections needed (2026-08-09)

Given the 27-wrong-CIK finding, checked whether the 47 ticker values in customer_identifiers had the same problem. Cross-referenced ~25 against the SEC company_tickers.json bulk file already fetched this session (all matched exactly, including two that also independently confirmed their corrected CIK values: Orbital Energy Group's SEC filing URL contained CIK 1108967, LiqTech's contained 1307579, both matching this session's CIK corrections). Spot-checked 3 of the smaller/less common tickers not in the bulk file (Global Power Equipment/GLPW, Orbital Energy Group/OEG, LiqTech/LIQT) via direct web search -- all confirmed correct.

Conclusion: tickers do not show the same error pattern as CIKs. Plausible explanation: tickers are short, memorable strings while CIKs are 10-digit numbers -- manual transcription of the latter is far more error-prone, consistent with the specific error types found (transpositions, off-by-one digits). No corrections applied; ticker data confirmed clean.

---

## AR Aging page / Credit Events desync — root cause found and fixed at the architecture level (2026-08-11)

Found via live user review: comparing the AR Aging table against the Credit Events feed for the same customer (Ranger Energy Services Inc) showed a direct contradiction -- the OVERDUE_AR event said "worst bucket: 61-90 days," but the AR Aging table showed $0 in that bucket, with the $175K sitting in 31-60 instead, and $75K sitting in "Current" despite that invoice being 30 real days overdue.

Root cause: v_ar_aging_current and v_ar_aging_portfolio (which the AR Aging page reads) sourced their numbers from ar_aging_snapshots -- a point-in-time snapshot table. Nothing in the system calls fn_refresh_all_ar_aging() on a recurring basis; it was last run manually during the F2 fix session (2026-07-12). By the time of this review (2026-08-11), the snapshot was 30 days stale, while Credit Events' OVERDUE_AR (fixed earlier this session to compute live) correctly reflected real time -- producing a visible, confusing discrepancy between two pages describing the same data.

This is the same "point-in-time snapshot with no recurring refresh" gap already flagged in the original B0 plan doc ("a real deployment needs snapshots written on a regular cadence by some scheduled job, which doesn't exist") -- now confirmed as a real, user-visible bug rather than a theoretical gap.

**Fixed at the architecture level, not just refreshed:** rewrote both views to compute aging buckets live from invoices on every query (same (CURRENT_DATE - due_date) logic as fn_refresh_ar_aging and this session's other live-computation fixes), instead of reading a snapshot. These views can now never go stale again, regardless of whether anything ever calls the refresh function. Verified byte-for-byte correct against the known-good portfolio distribution ($62,262,000 / $7,305,000 / $6,505,000 / $1,825,000 / $0 / $77,897,000 across current through over-90). Migration 20260811000000, baseline.sql updated to match. Commit 04a8add. Harness 8/8.

**Necessary companion fix:** discovering the live-computed truth also revealed the demo's invoice due_dates themselves were 30 days stale (frozen at the July 12 re-anchor) -- every invoice that should still show "current" was now genuinely 30 real days overdue, since due_dates don't move forward with time on their own. Re-anchored all 132 active invoices forward by the same 30-day gap, restoring the exact known-good distribution. Verified Boeing's invoices (previously false-showing "current" while actually 30 days overdue) correctly returned to real_days_overdue=0.

**ar_aging_snapshots and fn_refresh_ar_aging/fn_refresh_all_ar_aging were NOT dropped** -- left in place, now unused by these two views, out of scope for today's fix. Candidate for a future cleanup pass (either repurpose for a real historical-trend feature, or drop as dead schema, matching the pattern of other cruft already logged in this backlog).

**Remaining, smaller, ongoing item:** the views themselves can never go stale again, but the underlying demo invoice due_dates are still static data that will need periodic re-anchoring (same technique used today and in the original F2 fix) as real time continues to pass -- otherwise the "Current" bucket will again drift toward zero over weeks/months as static due_dates age past today. Worth considering, at some point: either a small maintenance script to make re-anchoring a one-command operation instead of ad hoc SQL each time, or redesigning demo seed dates to be relative-to-today rather than fixed calendar dates. Not urgent -- log for future consideration, not a blocker.

---

## Demo invoice date staleness — permanent fix (2026-08-14)

Follow-up to the AR Aging live-view fix earlier today. Immediately after fixing v_ar_aging_current to compute live, a live screenshot review showed the fix had already drifted again same-day -- Current dropped to $0, with the full $62.26M merged into the 1-30 bucket. Root cause: the manual re-anchor performed earlier today set every "current" invoice's due_date to exactly today (0 days offset), so literally any time passing at all (even hours) pushed them into the 1-30 bucket. Real AR doesn't work this way -- invoices are due at varied future points based on payment terms, not all simultaneously "due today."

Fixed properly: re-anchored current invoices using each customer's actual payment_terms_days (due_date = today + terms), giving realistic buffer. Verified byte-for-byte correct again. Re-ran ar-aging-agent to regenerate credit_events against the corrected data: OVERDUE_AR dropped from an inflated 54 events back to the correct 21 (matching the original A3 completion count), UTILIZATION_THRESHOLD_BREACH unchanged at 20.

**Built the permanent fix, not just another manual patch:** added demo_days_offset (each invoice's fixed position relative to "today," e.g. -87 or +43 days) and fn_reset_demo_invoice_dates() (idempotent: due_date = CURRENT_DATE + demo_days_offset, always correct regardless of elapsed time). Wired into initDemo.ts's existing DEMO_MODE-gated reset flow, so every demo init/reset now automatically re-anchors dates -- no more manual intervention ever needed. seed.sql's invoices block re-dumped via pg_dump from the corrected, verified-healthy live state (160 rows) to include real offset values. Migration 20260814000000, baseline.sql updated. Commits 4c341b1, 3a570a9.

Combined with today's earlier live-computed-views fix, the AR aging system is now fully self-healing at both layers: the views can't go stale (always compute from current invoice state), and the invoice dates themselves can't go stale (auto-reanchor on every demo init).

**Separate, unrelated, critical finding made during this investigation:** the "Reset Demo" button on the Actions page was rendered completely unconditionally -- DEMO_MODE was imported into that file but never actually used to gate it. In a real production deployment (DEMO_MODE=false), any user could see and click "Reset Demo," resetting pending actions, credit limits, SEC alerts, and news review state on real data. Found while verifying this whole feature would be safe to build (user directly asked "will this impact production" -- good instinct that surfaced a real pre-existing gap). Fixed immediately: wrapped in {DEMO_MODE && (...)}. Commit a768c11. Also swept all other pages for the same "DEMO_MODE imported but never used" pattern -- found and cleaned up two more (Customers.tsx, SecFilings.tsx), both confirmed to be genuinely dead imports (no destructive actions in either file, unlike Actions.tsx), not additional safety gaps. Commit 3bf018b.

**AR-related credit event counts, for reference:** 21 OVERDUE_AR + 20 UTILIZATION_THRESHOLD_BREACH = 41 total, matching the healthy known-good demo state (previously miscounted as 74 due to the same-day drift bug, itself caught and fixed within this same investigation).

---

## News Monitor page hid all real data — found via live user review (2026-08-14)

Found via a fresh full-dashboard review pass: News Monitor showed "No news alerts found. Agents will populate this automatically" while Credit Events (filtered to News) clearly showed 5 real, detailed NEWS_EVENT entries for the same customers (Northgate Fabrication, Atlas Precision, Heliogen, Arconic, Triumph Group) -- confirming the underlying negative_news data genuinely existed (verified directly: 5 rows, correctly is_demo=true).

Root cause: NewsMonitor.tsx gated its entire content behind `if (DEMO_MODE && !hasActiveSession) return <hardcoded placeholder>`, where hasActiveSession checks a sessionStorage flag only set once initDemo() fully completes. Any browser session that hadn't triggered a full init (a fresh tab, direct navigation to /news, etc.) would see this placeholder regardless of whether real data existed. CreditEvents.tsx uses the identical flag correctly -- only to gate a small pending-actions banner, never to hide the actual content -- which is why that page displayed correctly and exposed the contradiction.

Fixed: removed the entire gate block and its hardcoded placeholder from NewsMonitor.tsx, matching CreditEvents.tsx's correct pattern. The component's normal render path already handles a genuinely-empty dataset gracefully (shows "0 articles / 0 unreviewed"), so no replacement logic was needed. Also removed the now-fully-unused hasActiveSession variable and DEMO_MODE import. Commit 55cdec0. Confirmed via grep that only these two files (CreditEvents.tsx, NewsMonitor.tsx) reference the demo_activated sessionStorage key -- both now checked, only NewsMonitor.tsx had the bug. Harness 8/8.

**Pattern note:** this is the same root cause family as the unguarded Reset Demo button found earlier today (a DEMO_MODE-adjacent flag used incorrectly) and the several "column dropped but frontend never updated" bugs found earlier this session -- half-implemented demo-experience logic that silently diverges from what the underlying data actually shows. Worth a final broad sweep of any other sessionStorage/localStorage-gated conditional rendering in the frontend before considering the dashboard review complete.

---

## Two findings from continued live dashboard review (2026-08-14)

**1. News Monitor "Needs Review" is a permanent, unclearable counter -- no review action exists.**
User asked how to mark an article reviewed. Investigation: NewsMonitor.tsx reads n.reviewed to filter/count/display "Pending" vs "Reviewed," but there is no onClick, useMutation, or .update() anywhere in the file that could ever set reviewed=true. This isn't a demo-only cosmetic issue -- it's a real product gap: in actual production use, the "Needs Review" count could only ever grow, for the life of the product, since nothing can ever clear it. Matches the previously-documented "reviewed workflow never implemented" cruft, but this makes concrete that it's more than unused columns -- the UI actively presents "Needs Review" as if review were a real, actionable state. Decision needed (not made yet): build a real review action, or relabel/remove the framing until it exists. Logged for prioritization, not fixed this session.

**2. Heliogen's SEC alert was orphaned from its own event -- sec_monitoring said "alert active" with real risk signals, but zero corresponding credit_events existed.**
Found via a Heliogen vs Triumph side-by-side comparison: SEC Filings page showed "Alert Active" for both, but only Triumph displayed a risk-signal detail box. Investigation: Heliogen's sec_filings correctly held real risk_signals (going_concern_warning, cash_runway_<3_quarters, from a real 2025-01-12 10-Q), and sec_monitoring correctly had alert_triggered=true + risk_signals_detected populated -- but credit_events had zero rows for Heliogen from sec_monitor_agent. SecFilings.tsx's detail box is sourced entirely from credit_events (confirmed in code: a dedicated secEvents query filtered to source_agent='sec_monitor_agent'), so the box legitimately couldn't render even though the underlying detection state was genuine.

Root cause: Heliogen's alert state was set up via direct seed data (sec_filings + sec_monitoring inserted with a pre-set "final" alert state) without ever passing through the real agent pipeline that would also call publishEvent -- unlike Triumph, whose credit_events row has a real 2026-08-03 timestamp from an actual live agent run. A seeded "detection" without a matching "event log" entry.

Also surfaced along the way: GOING_CONCERN, despite being documented as a real typed event (not the SEC_OTHER catch-all) with its own schema (GoingConcernPayload: severity_score, filing_source_type, evidence_url, summary), had literally never been emitted anywhere in the system before this fix -- confirmed via a direct query returning 0 rows. This was the first real GOING_CONCERN event this system has ever produced.

Fixed: inserted the missing credit_events row directly, matching GoingConcernPayload's schema exactly and Triumph's row as a structural template (severity=critical, severity_score=92 matching the agent's own critical->92 mapping, title/description formatted to match the agent's own output style, evidence_url pointing to Heliogen's real verified CIK's EDGAR page). Verified: SEC Filings page now shows Heliogen's detail box correctly. Harness 8/8.

**Lesson:** the same "seeded end-state without the process that produces it" pattern already seen this session (alert_triggered on 44 companies, the AR aging snapshot staleness) -- worth a final targeted check: are there other sec_monitoring or negative_news rows with alert_triggered=true / reviewed states that similarly lack a matching credit_events row? Not swept exhaustively this session; Heliogen was found via direct visual comparison, not a systematic query.

Checked systematically (2026-08-14): a direct query for any sec_monitoring row with alert_triggered=true lacking a matching credit_events row (source_agent='sec_monitor_agent') returns 0 rows -- Heliogen was the only instance and is now fixed. Same check against negative_news (any row lacking a matching credit_events row from news_monitor_agent) also returns 0 rows. This closes out the sweep cleanly -- no other orphaned alert/detection rows exist anywhere in the current dataset.

---

## Information architecture decision: Credit Events vs Actions vs News Monitor/SEC Filings (2026-08-14)

Following the News Monitor "Needs Review" investigation, decided the product's three-tier structure explicitly, since it was implicit and partially undermined by the broken review workflow:

- **Credit Events** = the cross-agent FYI log. Condensed, scannable, one entry per detection. No per-item state, nothing to mark done.
- **Actions** = the only place review/approval happens. CIA-synthesized, multi-signal recommendations with a specific proposed change and rationale. Approve/Reject exists here and only here.
- **News Monitor / SEC Filings** = detail archives, not competing review queues. Full article text / per-company filing history and coverage status. Intended to be drilled into from a Credit Events source card (built earlier this session), not top-level destinations in their own right, even though they remain in the sidebar.

This resolves the direct tension the News Monitor investigation surfaced: three places showing overlapping content with no signal for why. The overlap is legitimate (activity feed + source archives is a normal pattern) but was previously uncommunicated.

Implemented: NewsMonitor.tsx subtitle changed from an actionable-sounding article/unreviewed count to "Full article archive. {N} articles — open one from a Credit Events source card for context, or browse below." SecFilings.tsx subtitle changed identically in spirit: "Per-company filing history and monitoring status — open one from a Credit Events source card for context, or browse below." Commits 2ab69d9, b913609.

**Longer-term idea (explicitly not committed to, not now):** user proposed a future configurable feature letting the user decide what qualifies as a Credit Event vs an Action, rather than the current hardcoded assessCompositeRisk/calculateCreditLimitProposal thresholds. Real idea, deliberately deferred per this backlog's existing "don't build speculatively" principle -- revisit if real usage shows the current thresholds don't match how users actually want to triage.

---

## New customer onboarding -- real gap found, deferred to a dedicated session (2026-08-16)

Found via live review: there is NO way to add a new customer through the UI anywhere in this app -- confirmed via full-codebase grep, zero matches for any "Add Customer" / customer-creation form. Combined with the locked V1 design (AR uploads never auto-create customers, reject unknown-customer rows by design), this means a brand-new production deployment cannot onboard a single real customer without direct database access. The V1 docs' "customers created manually for V1" phrasing assumed a CreditPilot team member doing that work during onboarding -- now that this is going open source with no onboarding team behind it, that assumption no longer holds.

**Decided:** build a real "Add Customer" form -- not urgent-fix scope, but a genuine, real feature, scoped to its own dedicated session (not squeezed into this one). Purpose: let the user test a completely fresh, non-demo company's full journey end-to-end (add customer -> get an internal code -> upload a real AR CSV referencing that code -> watch aging/utilization/agent detection work on real non-demo data).

**Requirements surfaced so far (not final, needs its own design session):**
- User wants the form "more detailed" than a minimal MVP version -- specifics not yet scoped.
- ERP integration matters here directly: internal_customer_code already exists in the schema specifically as "the customer's own internal code in their ERP for this entity" (per the original Customer Identifier Strategy doc) -- a future ERP sync (NetSuite, SAP, QuickBooks, etc.) would plug into this exact same field, matching incoming ERP records to existing customers the same way CSV uploads already do. The new customer form should likely label/frame this field with that future in mind (e.g. "ERP customer ID"), even though the actual ERP integration itself is out of scope for this build.
- User's longer-term roadmap (explicitly V3/V4, not now): full customer onboarding flow including credit check, compliance checks, and fraud checks for new customers. Noted for context/future design coherence, not to be built now.

**Deliberately out of scope for the eventual V1-scale build:** credit rating fields, DUNS/ticker/CIK entry, compliance/fraud checks, risk tags -- these are agent-populated or added later, not part of a basic add-customer form.

Do this as its own focused session, with proper requirements-gathering first (what fields, what validation, how it relates to the eventual ERP-sync vision) rather than jumping straight to implementation.

---

## Actions review: audit trail bug + corrupted seed data + open architecture question (2026-08-17)

User asked to review the 5 pending Actions against current data. 3 of 5 (Arconic, Howmet, Precision Castparts) checked out exactly -- current_exposure/credit_limit unchanged, utilization matches the cited rationale precisely. 2 of 5 (Ironwood Machine Works, Atlas Precision Manufacturing) did not: their credit_limit was already set to the *proposed reduced* value while the action still showed "Pending Approval," making the visible utilization (123.3%, 109.1%) contradict the rationale text (92.5%, 80%).

**Root cause 1, fixed: credit_actions audit trail never recorded what changed.** Actions.tsx's approveMutation inserts a credit_actions row on every approval but never populated old_limit, new_limit, or performed_by -- confirmed live: all 14 real approval events for these two customers, spanning May-August, have these three fields completely empty. Fixed: added old_limit: action.current_value, new_limit: action.proposed_value, performed_by: "demo_user" to the insert. Commit f06d27b.

**Root cause 2, fixed: seed.sql had the corrupted post-approval state baked in as if it were the original.** Confirmed pending_actions has zero seed rows (entirely dynamically generated, not static seed data) -- so the "current_value: 200000/1500000" seen on the still-pending actions did not come from a fresh computation against seed data; it's a persisted row from whenever these were first proposed, back when the limits genuinely were $200K/$1.5M. Separately, and independently wrong: seed.sql's customers.credit_limit for both was already the reduced value (150000, 1100000) instead of the true original -- someone had dumped a live, already-approved database state into the seed file at some point, permanently baking in the corruption on every fresh load. Fixed both customers' seed.sql credit_limit back to the true original (200000, 1500000), matching what their own pending_actions.current_value already correctly said. Commit 1f695a5. Live data corrected via direct SQL to match. Harness 8/8.

**Open question, NOT resolved this session -- needs its own investigation:** how/why did these two customers get approved repeatedly (14 credit_actions rows over ~3.5 months, May 3 through Aug 2, for just these two customers) with no seed data ever regenerating a fresh pending_actions row? pending_actions has no reset/regeneration logic found in initDemo.ts (confirmed no seed rows, no clear-and-regenerate pattern like credit_events/sec_filings/negative_news have). Two real possibilities, not distinguished this session: (a) these are genuinely the same original pending_actions row from initial creation, repeatedly re-approved by different testing sessions without ever being cleared after approval (meaning the "Pending Approval" state persisted even after approval -- a possible bug in whether approveMutation actually removes/hides an approved action from the pending view, or the UI was somehow re-showing it), or (b) some other process re-creates a matching proposal each time. Given the demo is about to go public and Approve/Reject is the core interactive feature, this deserves a dedicated session: trace exactly how a pending_actions row's lifecycle works from creation through approval, confirm it can never be approved twice or reappear as pending after approval, and decide whether pending_actions needs the same kind of demo-reset handling (clear + regenerate, or explicit exclusion from any reset) that credit_events/negative_news/sec_filings already have.

---

## Credit Events -> News Monitor click-through, properly built (2026-08-19)

User flagged the News Monitor subtitle ("open one from a Credit Events source card for context," written earlier this session as part of the information-architecture decision) was misleading -- Credit Events cards were never actually made clickable at all, and NEWS_EVENT credit_events rows had no foreign key back to their source negative_news article to link to even if they were.

Built properly rather than just correcting the copy: added negative_news_id (uuid, FK to negative_news, nullable) to credit_events. Wired it through publishEvent (now accepts an optional negative_news_id field, purely additive/backward compatible for all other agents) and both news-monitor-agent code paths (the live Tavily pipeline, which now retrieves the new negative_news row's id via .select("id").single() instead of a bare insert; and legacyPath, which already had the source row's id in scope). Backfilled the 5 existing demo NEWS_EVENT rows by matching customer_id + article_title, all matched cleanly 1:1.

Credit Events cards are now genuinely clickable where a real destination exists: NEWS_EVENT -> the exact News Monitor article (via negative_news_id), SEC-sourced -> the company's SEC Filings entry (via customer_id, same pattern used elsewhere). AR-aging events remain non-interactive -- their full detail is already shown inline on the card itself.

credit_events has zero seed rows (confirmed, entirely agent-regenerated) so no seed.sql data change was needed -- only the schema migration, added to both a standalone migration and baseline.sql (placed after negative_news's own CREATE TABLE, not after credit_events, since negative_news is created later in the script -- the naive placement would have broken a fresh database reset with a missing FK target, caught before committing).

Commits: afc669b (backend wiring), 804c99a (frontend click-through), f7ec57c (migration/baseline). Harness 8/8 throughout.

**Follow-up, same session:** user noted News Monitor still had no external article link, unlike SEC Filings' "View SEC Filings" link to real EDGAR. Investigation confirmed a second, separate real gap: NewsMonitor.tsx never referenced the negative_news.url field or rendered any external-link affordance at all, anywhere in the file -- a genuine production gap, not just a demo artifact, since real articles fetched via Tavily do have a real url that was simply never surfaced. Fixed: added a conditional external link on the headline (matching SEC Filings' exact ExternalLink pattern), rendering as plain text when url is null (true for all current demo articles) and as a working link once real production articles exist. Commit cc8d693.

---

## CRITICAL: cia-agent's core decisioning pipeline was substantially broken -- fixed, but never verified against a real (non-demo) run (2026-08-19)

Found while investigating whether Credit Events/Actions genuinely derive from real underlying data (user's question, prompted by the day's broader review). Root cause: the customer-context query in cia-agent's briefing/decisioning path selected a column called "name" -- this has never existed on the customers table (only company_name). The query's error was never checked, so it failed completely silently, and every downstream (customers ?? []) defaulted to empty. This broke three things: (1) the CIA-generated daily briefing text, which has likely rendered every customer as "undefined" -- the LLM apparently compensated by inferring real names from event titles elsewhere in its context; (2) the entire pending_actions credit-limit-decisioning block (assessCompositeRisk + calculateCreditLimitProposal), meaning no new proposals could ever be created, for any customer, ever; (3) credit-rating-downgrade synthetic event detection.

Also found and fixed two separate payload-key mismatches in the same block: utilization_pct read a key actually named utilization_percent in the real schema (silently defaulting to 0% always), and a nested payload.buckets.bucket_over_90 path that doesn't exist in the real flat schema (correct key: bucket_over_90_usd, silently defaulting to $0 always). Combined with the above, nearly every credit-limit-reduction trigger condition in calculateCreditLimitProposal could never actually fire. Also fixed assess-composite-risk.ts referencing three event-type strings that don't exist in the real V1 taxonomy (NEGATIVE_NEWS_HIGH, NEGATIVE_NEWS_CRITICAL, GOING_CONCERN_WARNING vs real NEWS_EVENT/GOING_CONCERN), making those threshold adjustments dead code. Commit 7b7a6d5.

**Explains a previously-unexplained observation from earlier this session:** the 5 pending_actions rows reviewed on 2026-08-17 all dated from April/May, with rationale text that didn't match calculateCreditLimitProposal's current template strings. They were created by an earlier version of this code, before this drift -- consistent, not contradictory.

**NOT verified end-to-end against a real, live run** -- confirmed via direct testing that DEMO_MODE's briefing path returns a fully hardcoded DEMO_BRIEFING stub (line 852, unconditional early return) before ever reaching the fixed code, so the live public demo is completely unaffected by this bug either before or after the fix (visually nothing changes). This means the fix could not be safely tested against the live shared Supabase project without either a temporary DEMO_MODE=false toggle (risky on shared infra) or an isolated test environment. Static verification was thorough (every real column name and payload key confirmed directly against the database and Zod schemas, full diff reviewed line by line), but **this must be verified with a real end-to-end run in a non-demo/staging environment before relying on this pipeline in production** -- flagging explicitly rather than assuming the fix works just because it type-checks and matches the schema on paper.

**Verified live, 2026-08-28.** Given no genuine non-demo (is_demo=false) data exists anywhere in this database, a full behavioral test (real customer names resolving correctly end-to-end) wasn't possible -- but the specific failure mode this fix targets (a malformed column reference) fails at SQL parse time, before any rows are considered, regardless of whether data exists to return. Briefly toggled DEMO_MODE=false on the live project (confirmed with the user first that no one was using the demo at the time), called the briefing endpoint directly: it executed cleanly with zero errors ("No unprocessed credit events found. All signals are up to date."), and correctly evaluated agent staleness across all three agents without error -- directly exercising both fixed queries (the customer.name column and the agent_runs.created_at column) against the real, live schema. Reverted DEMO_MODE=true immediately after. Harness confirmed 8/8 clean afterward (one transient SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED error on the first post-revert run, cleared on retry -- unrelated infrastructure blip, not a regression). This closes out the "must verify in a real environment" flag from the original fix.

---

## Systematic sweep: unchecked Supabase queries across the backend (2026-08-20)

Direct follow-up to the critical cia-agent bug (customer.name column, agent_runs.created_at column -- both never existed, both silently broke real features because the query error was never checked). Given the same failure shape (destructure data, never check error) had now caused two separate serious bugs, did a systematic grep across all 4 edge functions for every instance of this exact pattern, rather than continuing to find these one at a time by accident.

Found 15 instances total. Cross-checked every selected column name against the real schema (baseline.sql) for each:

- 1 confirmed second instance of the exact same bug class: cia-agent's own agent_runs query also selected created_at, which doesn't exist -- meant every single agent was reported "stale" on every briefing regardless of actual freshness. Fixed alongside the other cia-agent items below.
- 2 genuinely safe fallbacks, no fix needed (news-monitor-agent's dedup check has a working error-checked insert one step later as defense-in-depth; cia-agent's suggestions-prompt query already falls back to DEMO_SUGGESTIONS regardless of this query's outcome).
- 12 real gaps needing error handling -- none were column-name bugs, but several had real behavioral consequences on a genuine failure: cia-agent's named-customer invoice/payment questions would have silently broadened to whole-portfolio answers; ar-aging-agent's payment-behaviour refresh could silently reset a real customer's payment profile to empty; sec-monitor-agent's bare sec_filings insert could let a duplicate filing (or any other insert failure) fall through and re-emit a fresh GOING_CONCERN/SEC_OTHER alert for an already-processed filing -- this one was upgraded from "add logging" to a real behavior fix (capture the error, skip the filing on any insert failure, matching the same skip logic as the dedup check above it).

All 12 error-handling gaps fixed with the minimal correct change in each case -- error captured and logged, no control flow changed except sec-monitor-agent's insert (a genuine behavior fix, not just added visibility). Commits: cc9fc9c (cia-agent, includes the second confirmed bug), 3751014 (ar-aging-agent), e3b1f89 (news-monitor-agent), a7a8dfe (sec-monitor-agent). All 4 functions deployed. Harness 8/8 throughout, deno check clean on every file touched.

**This closes out the systematic sweep prompted by "how many more bugs like this exist" -- every unchecked-Supabase-query instance in the entire backend has now been either fixed or confirmed genuinely safe.** Going forward, any new Supabase query added to this codebase should destructure and check error from the start, matching the pattern now consistently applied everywhere.

---

## Pre-petition invoices had unboundedly-growing days-overdue figures -- fixed (2026-08-22)

User caught via a live CIA answer: pre-petition invoices (Proterra, Yellow, Rite Aid, Spirit Airlines) showed 604-1,118 days overdue -- clearly absurd. Root cause: pre-petition invoices were deliberately excluded from the demo_days_offset auto-reanchor system built earlier this session (per the original F1 design: "bankruptcy freezes normal aging" -- these due_dates shouldn't shift forward like normal invoices). But nothing ever gave them a replacement frozen value either, so their due_dates just sat static at their original 2023/2024 seed dates while everything elsewhere in the app (the CIA, live-computed views) computes days-overdue live against today's real date -- producing an unbounded, ever-growing number with no ceiling, currently over 1,000 days for three companies and climbing daily.

Fixed by extending the existing system rather than building something new: populated demo_days_offset for all 10 pre-petition invoices with fixed, staggered values (95-140 days), preserving the existing narrative structure (the three scenario='bankruptcy' customers -- Proterra, Yellow, Rite Aid -- staggered deeper than Spirit Airlines' separate pre-petition-AR signal on top of its negative_news scenario). All land solidly and permanently in the 90+ aging bucket. This required zero code changes -- fn_reset_demo_invoice_dates() already updates any row WHERE demo_days_offset IS NOT NULL; these rows were simply never populated. Purely a data change, confirmed zero effect on any real production deployment (this function is only ever called from DEMO_MODE-gated frontend code).

Also re-dumped the full invoices table into seed.sql (160 rows) to capture both this fix and the routine full date-refresh from calling fn_reset_demo_invoice_dates(). Commit 0abdeb4. Verified live: re-asked the exact question that surfaced this, confirmed absurd day counts are gone. Harness 8/8.

---

## CIA invoices fallback query bug (paid invoices crowding out real overdue AR) + systematic check of all 6 fetch branches (2026-08-22)

User caught via a live CIA answer: "give me an update on the AR aging report" returned "all invoices paid except Proterra," flatly contradicting the real portfolio (~$16M genuinely overdue). Root cause: the invoices fetch's no-named-customer fallback (`q.lt("due_date", todayStr).order("due_date", ascending: true).limit(20)`) never excluded paid/written_off statuses, and sorted oldest-due-date-first. Confirmed live: the top 20 results by this exact query were 18 paid invoices + 2 Proterra pre_petition rows -- zero genuinely current/overdue invoices ever surfaced. Not a hallucination -- the CIA accurately described the (wrong) data it was given.

Fixed: added `.not("status", "in", "(paid,written_off)")` to this fallback branch only (the named-customer branch was already correct). pre_petition invoices remain included (legitimately relevant to a general overdue question). Commit 41f5862. Harness 8/8.

**Systematically checked all 6 of cia-agent's table-fetch branches for the same shape of bug** (a no-named-customer fallback returning a limited, sorted slice without excluding irrelevant/terminal rows), not just assuming the fix was isolated:

- credit_events: clean -- orders by severity_score DESC then created_at DESC, no settled/terminal status concept applies.
- customers: clean -- generic fallback uses fn_rank_portfolio_risk() (the properly-designed B5 ranking function), not a naive limit/sort.
- invoices: was broken, now fixed (above).
- payment_transactions: clean -- orders by payment_date DESC (most recent first, correct direction), no status concept (every row is a completed transaction).
- negative_news: clean -- orders by news_date DESC, no status concept.
- sec_filings: clean -- orders by filing_date DESC, no status concept.

invoices was the only table with this specific risk, for a specific reason: it's the only one of the 6 where rows carry a genuine settled/terminal state (paid, written_off) requiring deliberate exclusion -- every other table's rows are either permanent facts or already correctly ordered so the most relevant result surfaces first regardless of any filtering.

---

## Strategic notes from user, captured for future planning (2026-08-22) -- not acted on this session

User shared priorities while continuing the live demo review, explicitly framed as important context to preserve, not immediate work:

**1. Invoice lifecycle end-to-end (get data, read, update, display).** Currently: the only ingestion path is manual CSV upload, which fully *replaces* a customer's open/overdue invoices per the locked Input Contract (no incremental update, no single-invoice edit). No payment-recording UI exists -- payment behaviour is inferred from AR snapshots over time (analyse-payment-behaviour skill), never entered directly. Reading/display is well covered (AR Aging table, Customer detail Invoices tab, CIA). Clarified by user in follow-up: CSV upload is not necessarily a gap needing replacement -- it's a viable long-term ingestion mechanism, since it can be automated on the customer's own end (e.g. a scheduled export from their ERP). The real open question is specifically the update/payment-recording story, not the ingestion mechanism itself. Connects to the ERP-integration vision already logged elsewhere in this backlog (internal_customer_code as the future ERP-sync key).

**2. Customer data table completeness for future KYC/onboarding/fraud agents.** Confirmed real gaps in the current customers schema: no structured street address (headquarters is free-form display text only, not parseable), no website/domain field, no legal-entity-name vs. trade-name distinction, no tax ID/EIN, no industry classification codes (NAICS/SIC -- sector/industry are both free text). User explicitly said this is V2-after-launch scope, but wants it flagged as a real priority for that phase, not an afterthought -- likely worth designing alongside the already-logged "Add Customer form" work (its own dedicated session, logged 2026-08-16) so the two aren't designed independently and then need reconciling.

**3. "The Base" must be solid before building more agents on top.** User's own framing for the priority that should govern near-term work: the core data/agent infrastructure (schema, identifier strategy, event taxonomy, agent contract pattern) needs to be genuinely trustworthy before KYC/onboarding/fraud/credit-check agents get built on it -- otherwise those future agents inherit and compound whatever's still wrong in the foundation. This is explicitly the principle behind this entire session's work (schema drift fixes, customer_identifiers, the cia-agent decisioning pipeline fix, the systematic error-handling sweep) -- worth keeping as the explicit lens for prioritization going forward, not just an implicit pattern.

**4. Customer profile fields -- elevated priority, concrete next step.** User will provide a draft template of desired customer profile fields (addressing gap #2 above) for review and feedback, once the current CIA/dashboard review is complete. Not yet provided as of this note.

No action taken this session on points 1-3 -- captured for future planning only, at user's explicit request to continue live testing instead.

---

## CIA sourcing-integrity bug: sources could show a citation the model never actually used (2026-08-22)

User caught via two separate live questions ("anything alarming on the ar aging report?" and "largest past due?") both showing only "Northgate Fabrication" as the sole source -- unrelated to either answer's actual content. Root cause: credit_events_matched (rendered as "Sources") was set whenever a keyword search matched even a single event (filtered.length > 0), but credit_events (the actual data passed to the model to write its answer) only used that filtered set when length >= 2, otherwise silently falling back to a much broader, unfiltered query. Both cases traced to the same coincidental cause: the word "largest" happens to appear in Northgate's own event description ("its largest customer terminated..."), producing exactly 1 keyword match -- good enough under the old logic to be cited as a source, not good enough to actually inform the model's answer.

Fixed by using the same >= 2 threshold for both decisions -- a match is now only ever shown as a source when it's also what the model actually used. Commit ec9e0db.

**User asked directly whether this could recur for other unpredictable questions.** Answered honestly: this specific fix closes the underlying decision-logic inconsistency, not just today's two examples -- it applies to every future question, not only ones tested. But keyword/substring matching remains an inherent heuristic: 2+ genuinely unrelated events could still coincidentally share a matched word and clear the threshold together, a smaller residual risk that no amount of question-testing can fully rule out, since it's structural to the matching approach itself. A more robust future direction (not built now): have the model self-report which specific sources it actually cited after generating its answer, rather than pre-selecting candidates via keyword matching beforehand.

**Test-maintenance note:** this fix caused a real, expected harness change -- q5_vague_qualitative ("Should I be worried about American Airlines?") started failing on min_sources (expected >=1, got 0). Investigated rather than reverted: confirmed live and via direct query that American Airlines genuinely has zero credit_events right now, so its answer is correctly, honestly built entirely from the customers table with no event-level source to cite. The old min_sources:1 expectation had been calibrated against the sourcing bug itself (a coincidental match used to satisfy it even though not genuinely used). Updated to min_sources:0, matching this project's established principle of deliberate test maintenance rather than reverting a correct fix to keep an outdated assertion green. Commit b00680b. Harness 8/8.

---

## CIA text-matching robustness -- three related bugs found in one session, mitigation plan (2026-08-22)

Found and fixed three distinct bugs in cia-agent's hand-rolled regex-based text extraction, all within one testing session: (1) the invoices fallback query not excluding paid/written_off statuses (commit 41f5862), (2) credit_events_matched/credit_events using inconsistent match-count thresholds, allowing a coincidental single keyword match to be cited as a source the model never actually used (commit ec9e0db), (3) possessive company names ("Cascade's") being mangled by apostrophe-stripping into a non-matching string ("cascades"), silently breaking event sourcing for completely natural phrasing (commit d39a14d). All three were found via live, natural questions -- not synthetic edge cases -- and user asked directly how to mitigate this class of bug going forward, not just patch instances as found.

**Three-tier mitigation plan, decided this session:**

1. **Near-term (doing now): expand the automated test harness with adversarial phrasing.** Add test questions specifically targeting this failure class -- possessive forms, lowercase abbreviations, hyphenated/parenthetical company names -- so future regressions in this exact area are caught automatically rather than only when manually tested live.

2. **Near-term (doing now): replace hand-rolled regex/stoplist extraction with the existing trigram fuzzy-matching infrastructure.** idx_customers_name_trgm already exists (built for AR CSV upload customer matching) and is inherently more robust than regex + stoplists -- doesn't care about apostrophes, capitalization, or exact substrings. Scope: touches every customer-name-detection call site in cia-agent (~5-6: invoices, payment_transactions, customers, negative_news, sec_filings), needs real similarity-threshold tuning, and full regression testing against everything currently working. Estimated as a full focused session, comparable in scope to the already-deferred Add Customer form or pending_actions investigation.

3. **Deferred to V3+ (logged, not started): post-hoc citation instead of pre-guessing sources.** Instead of selecting candidate sources via keyword matching before the model answers, have the model report which sources it actually cited after generating its answer. This is a genuine architectural redesign, not a patch -- new prompt design for inline citation, new response parsing, replacing the entire current pre-built Sources pipeline, frontend changes, and its own validation that it's actually more reliable rather than differently fragile. Explicitly NOT scoped for the near term; captured here so the idea isn't lost.

User's explicit priority: "important to have this right" -- proceeding with tiers 1 and 2 now, deliberately, not rushed.

---

## CIA retrieval/sourcing plan revised -- supersedes the trigram-matching plan above (2026-08-22)

Follow-up to "CIA text-matching robustness" (logged earlier this session). Investigated tier 2 of that plan (replace regex extraction with pg_trgm word_similarity matching) empirically before building it -- tested real questions against the real customer list. Findings: word_similarity correctly scored genuine company mentions very high (e.g. "cascade" -> "Cascade Industrial Systems" = 1.0, "cascade's" with the possessive unstripped = 0.8, "arconic" -> "Arconic Corporation" = 1.0) and correctly scored short generic words low (e.g. "largest" maxed at 0.125). But a real, disqualifying problem surfaced: "utilization" -- a core domain term that should trigger a broad portfolio search, not bind to one customer -- scored 0.8 against "Cascade Industrial Systems", coincidentally, via shared Latin-root trigram patterns. No threshold cleanly separates this from genuine matches. User's assessment, independently arrived at: this is fundamentally fragile -- trigram matching is still a string-similarity heuristic patched with an ever-growing stoplist, the same shape of problem as the regex approach it would replace, just with fancier math.

**Revised direction, decided this session:** the actual problem (does this arbitrary sentence refer to a company, and which one) is a language-understanding problem, not a string-matching problem -- string algorithms are structurally the wrong tool regardless of tuning. Replace the regex/trigram-based customer-name and keyword extraction with a small, fast, structured LLM call (e.g. Claude Haiku) given the question plus the real customer list, returning which customer(s) if any the question concerns. This is a genuinely different approach, not a bigger version of the same idea -- it handles possessives, plurals, abbreviations, nicknames, and typos as a natural consequence of understanding language, not as individually-patched special cases.

**Paired with a scoped (not full-redesign) version of the earlier-logged "post-hoc citation" idea (originally scoped for V3+):** re-examined and now believed smaller than first estimated -- have the model report which specific source IDs it actually cited as part of the same structured JSON response it already returns (alongside the existing confidence/confidence_reason fields), rather than a separate architectural pipeline. This fixes attribution accuracy (sources matching what was actually used) independently of retrieval accuracy (finding the right data in the first place) -- both are needed, since today's three bugs were a mix of both failure types.

**Honest tradeoffs of the LLM-retrieval approach, not oversold:** adds one extra fast/cheap LLM call per question (latency + cost, though Haiku is inexpensive for a short classification-style task); introduces non-determinism to something currently deterministic (mitigable with structured output, low temperature); needs the customer list passed as context each call (fine at ~59 customers today, would need real design work if the portfolio grows into the thousands -- not addressed now).

**Multi-language support -- explicitly deferred, but flagged as genuinely important soon (not hypothetical), per user.** Real, structural finding while evaluating this: the current regex approach ([A-Z][a-zA-Z]+) cannot work correctly for many languages at all, not just poorly -- German capitalizes every common noun, not just proper nouns; French/Spanish accented characters (e, n with diacritics) fall outside [a-zA-Z] and would truncate names mid-word. Trigram matching is more language-neutral in principle but the stoplist approach is 100% English-only regardless. The LLM-retrieval approach handles this naturally as a byproduct (understands "l'entreprise Cascade" refers to Cascade without language-specific tuning) -- post-hoc citation alone would NOT solve this, since it only fixes attribution after retrieval, and retrieval is exactly where the language problem lives. User: multi-language can wait, but will be needed "pretty soon" -- not hypothetical, real near-term need. Captured here so it's factored into the LLM-retrieval design when built, not bolted on separately later.

**Net scope assessment:** LLM-based retrieval + scoped post-hoc citation together are estimated as comparable in total size to the originally-scoped trigram-matching plan alone -- not two separate large projects. Supersedes tier 2 of the earlier plan; tier 1 (expanded test harness) and the original tier 3 framing are superseded by this more precise combined plan. Not started this session -- captured for a dedicated future session.

**Further confirmed evidence for this plan, same session:** "what overdue customers should I keep an eye on?" surfaced the sourcing-table-lock problem concretely. The answer correctly highlighted 4 pre-petition bankruptcy customers (Rite Aid, Spirit Airlines, Proterra, Yellow Corporation) as highest priority, pulled accurately from the invoices table (pre_petition status is never assigned its own OVERDUE_AR event by ar-aging-agent -- confirmed via direct query: Proterra and Yellow have zero credit_events at all, Rite Aid/Spirit Airlines only have an unrelated UTILIZATION_THRESHOLD_BREACH). But Sources showed none of these four -- structurally impossible, since sourcing only ever reflects credit_events_matched -- while showing 21 companies matched broadly on the word "overdue" (a legitimate, real match, but most of those 21 were never actually discussed in the answer). Not a new bug -- confirms sourcing is structurally locked to one table even when the correct answer legitimately spans several (invoices + credit_events here). Directly what the LLM-retrieval + post-hoc citation redesign above would fix categorically, since it would report what was actually used regardless of source table. No fix applied this session -- evidence noted for when that redesign is built.

---

## CIA citation redesign shipped: mechanically-verified inline citation, replacing pre-guessed keyword matching (2026-08-27)

Full outcome of the multi-step redesign discussed and built this session, following three real sourcing bugs found via live testing (invoices fallback showing paid invoices, sources citing something the model never used, possessive company names breaking keyword matching).

**Design process, in order:** first proposed trigram fuzzy matching (reusing existing but never-implemented idx_customers_name_trgm infrastructure) -- empirically tested before building, and disqualified when "utilization" (a core domain term) scored 0.8 similarity against an unrelated customer name, a false-positive no threshold could safely rule out. Revised to LLM-based retrieval -- user pushed back on fragility, prompting a genuine first-principles reconsideration of the whole problem (guess-before, self-report-after, or something else), followed by real research into how production RAG/citation systems (Perplexity-style, per this codebase's own commit history and naming) actually solve this, which surfaced two concrete findings: (1) even the best production citation systems benchmark around 85-87% grounding accuracy, not 100% -- a real, expected residual rate, not a target to hit; (2) the correct production pattern is inline citation against a pre-numbered evidence list, paired with mechanical post-hoc verification -- not pre-guessing from question keywords, and not asking the model to self-report sources after the fact (which this codebase's own history shows already failed once, per a prior "intermittently returned empty arrays or fabricated events" comment discovered via git archaeology on commit 4f6e9d3).

**What shipped:** every record across all 6 context tables (customers, invoices, payment_transactions, negative_news, sec_filings, credit_events) gets a short reference tag (C1, I2, E3...) shown inline to the model, which cites the exact tag(s) supporting each claim as it writes -- the same generative moment as the claim, not a separate recall step. After generation, every cited tag is mechanically verified against the real, known list of what was provided; anything that doesn't match is silently discarded, never shown. Sources are built entirely from verified tags. Only credit_events/negative_news/sec_filings produce a source card today (matching the frontend's existing three source types); customers/invoices/payment_transactions citations are verified but not yet surfaced -- a natural future extension now that CustomerDetail's Invoices/Payments tabs exist, not built this session (kept in scope discipline).

Commits: 5469b58 (core redesign), 7caf130 (range-notation stripping fix, found via live testing), fe9002d (RISK_FLAG=HIGH prompt instruction -- insufficient alone), 816ec72 (structural fix: dedicated high-risk customer context section, the change that actually resolved the framing issue reliably), a3f302c (test threshold corrections for q1/q6, both confirmed honest customers-table-only answers).

**Verified outcomes:** zero false-positive citations observed across the entire testing process (the core safety property the whole redesign targeted) -- every single failure seen, across roughly a dozen spaced test runs, was under-citation or incomplete framing, never a wrong source shown. The table-lock problem (pre-petition bankruptcy customers having no possible source even when correctly discussed) is now categorically fixed, since citation can come from any table. q1 (the portfolio risk-ranking question) improved from failing on wrong framing/missing companies most runs to passing roughly 6 of 7 spaced runs, with the one residual failure being genuine model-choice variance, not a framing regression -- this matches the real, published ~85-87% grounding-accuracy baseline for production citation systems, and is treated as expected residual risk rather than a bug to keep chasing.

**Explicitly decided NOT to build, given the residual risk is now understood as inherent:** a deterministic, code-driven (non-LLM) construction of the specific high-risk-customer-list portion of the answer, which would guarantee 100% reliability for this one question type at the cost of being a special case rather than a general solution. Revisit only if a specific business need for guaranteed determinism on this exact question emerges.

**Remaining follow-up work, already logged separately:** LLM-based retrieval to replace the still-regex-based table-routing/keyword-extraction logic (multi-language support depends on this), and surfacing customers/invoices/payment_transactions citations as real source cards once a frontend destination exists for them.

**Follow-up shipped, same day:** customers/invoices/payment_transactions citations now produce real, clickable source cards -- previously verified but deliberately not surfaced, since the frontend had no destination for them. They route to /customers?customer_id=X, which now reads the param and opens that customer's detail Sheet automatically (Customers.tsx had zero URL-param support before this). Matches the existing standard already accepted for sec_filings sources (open the record, not a specific row) -- Invoices/Payments tabs don't yet have row-level highlight infrastructure, so jumping to a specific tab was deliberately left out of this pass rather than building half a feature. Verified live: "Should I be worried about American Airlines?" (confirmed entirely customers-table-sourced, zero credit_events) now correctly shows a real, clickable customers source card. Commit ae45366. Harness 8/8.

---

## CIA arithmetic-reliability sweep: LLM-computed aggregates fixed across the board (2026-08-29/30)

Found live, by the founder testing "ar aging summary" repeatedly and noticing genuinely different totals each time (not phrasing variance -- real numbers off by millions: $7.58M vs $10.44M). Root cause: several question types handed the model raw multi-record data (invoices, customer balances) and implicitly expected it to sum/average them correctly itself -- a well-documented LLM limitation, not a retrieval or prompting problem. Researched properly before fixing (per project convention): confirmed this as a named, standard production pattern ("Zero Mental Math Architecture" / deterministic tool-use), with one cited clinical-AI study measuring 5.5x-13x error-rate reduction from offloading arithmetic to deterministic tools.

**Fix wave 1 (commit d92dfc1):** portfolio-wide AR aging totals, using the existing v_ar_aging_portfolio view. Verified live: 3 identical runs, byte-for-byte identical totals afterward.

**Systematic sweep (same session):** audited every branch of fetchRelevantData for the same vulnerability class. Found 4 more real, unfixed instances plus correctly deprioritized several low-risk ones (credit_events/negative_news/sec_filings involve counting short rows, not summing dollar figures -- a much milder version of the same weakness).

**Fix wave 2 (commit f5adb18):** (1) named-customer AR aging totals via v_ar_aging_current; (2) combined totals when 2+ companies are named in one question, computed server-side; (3) combined credit limit/exposure across the RISK_FLAG=HIGH set; (4) named-customer payment behaviour totals via v_payment_behaviour (found to be a better, live-computed source than the periodically-updated customer-table fields). Portfolio-wide payment behaviour deferred -- no aggregate view exists yet, would need a new migration; logged as a real follow-up, not silently dropped.

**Deferred piece shipped (2026-09-05, commit fc3f8b5).** New v_payment_behaviour_portfolio view, computed directly from raw payment_transactions rather than aggregating the already-averaged per-customer view -- AVG() over raw rows is inherently volume-weighted, avoiding the averaging-of-averages mistake this exact rule exists to prevent. New OFFICIAL PAYMENT BEHAVIOR PORTFOLIO TOTALS section and prompt instruction. Also found along the way: the payment_transactions branch had no portfolio-wide case at all before this, unlike AR aging's symmetric named/sector/portfolio design. Verified live: "average days to pay across the whole portfolio" correctly returns 51.3 days, matching the applied view exactly. Harness 8/8, consistency check 8/8 across all three flagged questions. This closes the last deferred item from the arithmetic-reliability sweep.

**Process failure worth naming honestly:** the sector-exposure aggregation case -- the ORIGINAL bug the founder had already found and reported, before any of this investigation started -- was correctly identified in the sweep's own findings table, but got mislabeled as "already handled" during planning when it was only "already identified," and was never actually included in fix wave 2's scope. Confirmed live immediately after wave 2 shipped: the exact original bug was still fully live, still producing different totals every run. This was a real tracking gap between what was found and what was built, not a false alarm -- caught only because the founder re-tested the original case after the "fix," rather than assuming the sweep had covered it.

**Fix wave 3 (commit 40a7068):** the sector-exposure case, same pattern -- pre-computed combined total via a new context section, plus raised the sector query's row cap (30 -> 50, since Aerospace & Defense alone has 26 customers, too close to the old limit for safety). Verified live: 4 consecutive runs, identical $51,070,000 / 26 customers every time.

**Durable outcome:** CLAUDE.md created at the repo root (commit 45f38aa) -- read automatically at the start of every future session -- capturing this as a standing principle for all future agents/fields/features, not a one-off fix. Also closes the long-pending "CLAUDE.md to repo root" housekeeping item.

Harness 8/8 maintained throughout all three waves.

---

## LLM-based CIA retrieval shipped, replacing regex-only routing (2026-08-31)

The long-deferred retrieval redesign, following the citation redesign and arithmetic-reliability sweep from the prior session. Commit 80f9e07.

**What shipped:** a new Haiku call (extractQuestionEntities) resolves company mentions, sector, and table routing in one language-agnostic pass, replacing routeQuestion's regex table-detection and fetchRelevantData's regex proper-noun/SECTOR_KEYWORDS extraction as the primary path -- the same structural weakness behind the earlier trigram-matching disqualification and the possessive-apostrophe hack ("Cascade's"). Extracts only the raw mentioned fragment, never a resolved canonical name -- the existing, proven ILIKE fuzzy DB search stays the sole source of truth for actual matching. Falls back to the exact prior regex behavior (preserved as regexFallbackExtraction, not deleted) on any extraction failure -- never a hard failure of the question.

**Bundled in the same change, both closing gaps this change would otherwise have created or left open:**
- Sector detection previously only applied to the customers table; invoices and payment_transactions had no sector awareness at all (a sector-scoped AR/payment question fell through to fully portfolio-wide). Now propagates correctly to all three.
- That propagation would have created a new arithmetic-reliability gap per the CLAUDE.md principle -- a sector-scoped question would return up to ~50 pre-computed per-customer rows with no summed total, the model would have to sum/average them itself. Fixed in the same commit: new OFFICIAL AR AGING SECTOR TOTAL and OFFICIAL PAYMENT BEHAVIOR SECTOR TOTAL sections, the latter using volume-weighted averages (weighted by each customer's total_payments) rather than a naive average-of-averages, since transaction volumes vary widely across customers.

**Verified live:**
- German: "Sollte ich mir Sorgen um Arconic machen?" -- correctly extracted "Arconic" despite German capitalizing common nouns too ("Sorgen"), answered fully in German, 4 accurate sources.
- French: "Quelle est notre exposition totale au secteur aérospatial?" -- correctly identified the Aerospace & Defense sector from "aérospatial" (accented, no lexical overlap with English keywords), answered in French, used the exact same $51,070,000 deterministic total already verified the prior session -- confirming this redesign integrates correctly with the arithmetic-reliability work rather than sitting apart from it.
- Sector AR aging total: "What is the total overdue AR for the aerospace sector?" -- $6,850,000, byte-for-byte identical across 3 consecutive runs.
- Harness 8/8 after deploy (one incidental failure on first post-deploy run, investigated and confirmed unrelated -- see below).

**Found during verification, deliberately deferred, not yet fixed:** q3_utilization_aggregation intermittently omits real, correct high-utilization customers (Ironwood 123%, Cascade 196%) that are consistently present in the underlying data -- confirmed via 3 repeated runs, 2 of which correctly named both. Investigated and confirmed this is NOT caused by this session's changes (the portfolio-wide customer fallback path is identical whether routed by regex or LLM for a no-company-named question), and is the same shape of problem as the RISK_FLAG=HIGH inconsistency fixed the prior session -- the model inconsistently selecting from a set it should name completely, just for a different criterion (utilization threshold rather than the locked V1 risk rule). Queued as the next fix, same session.

---

## Utilization-list reliability: three attempts, a new durable pattern (2026-08-31)

Full story of fixing the utilization-consistency issue flagged during the LLM retrieval redesign's verification. Commits c7604be (attempt 1), c185413 (attempt 2), c45c1c1 (attempt 3, the one that worked).

**Attempt 1** applied the proven RISK_FLAG=HIGH structural pattern -- a dedicated OFFICIAL HIGH-UTILIZATION CUSTOMER LIST section, computed from customerLines. Made things WORSE, not better (0/4 live runs correctly named the two most extreme cases, down from ~5/8 before the fix). Root cause: for portfolio-wide questions, customerLines is built from fn_rank_portfolio_risk()'s output, deliberately scoped to the locked V1 credit-risk rule (score<30/bankruptcy) and confirmed live to return only ~25 of 59 customers -- structurally excluding the two highest-utilization customers in the portfolio regardless of severity, and the new strongly-worded "complete answer" instruction likely suppressed the model's previous, partially-successful fallback to credit_events.

**Attempt 2** fixed the data-completeness bug correctly -- a new, independent, minimal-column scan of all 59 customers fired in parallel with (not instead of) the untouched fn_rank_portfolio_risk() call, only in the portfolio-wide branch. This closed the structural gap (the data was now always genuinely available) but the underlying reliability problem persisted: 5/8 live runs correctly named both customers. The remaining failures were the model inconsistently complying with "name every one" when free-generating a 20-item list -- a materially harder compliance task than the 7-item RISK_FLAG=HIGH case that pattern was borrowed from.

**Research, before a third attempt.** Two rounds of real research (not assumption) confirmed: reliable multi-item enumeration from memory is a well-documented, structural LLM limitation (arXiv 2512.04727: "none of them spontaneously engage in counting"), not something prompt wording can fully solve. A second paper (arXiv 2602.06103) pointed to the actual production-grade fix: separate correctness from generation entirely -- an external, deterministic controller enforces which items get covered, the model only handles local narration. A second research pass specifically confirmed this doesn't carry the performance/complexity costs of unrelated LLM-reliability techniques (constrained-generation retry loops, temperature=0): those costs come from asking the model to generate-then-validate-then-retry; simply splicing a pre-built, correct block into the answer requires no extra LLM call, no retries, no added latency.

**Attempt 3, the durable pattern.** Deterministic list construction with a marker-based splice. The model no longer names customers, percentages, or a count itself -- it writes one brief intro sentence and emits a literal {{HIGH_UTILIZATION_LIST}} token (or omits it entirely if the question doesn't call for the full list), replaced post-generation, before tag verification runs, with a block built directly from the already-correct highUtilizationLines data -- including real citation tags from tagMap, so the existing verification/stripping/sources pipeline handles it identically to any model-written citation, with nothing special-cased, and these citations can never fail verification since they're minted from the same source of truth as the data itself.

**Verified live: 8/8 consecutive runs**, both customers present every time, zero marker leakage into visible text, correct count (20), all 20 correctly cited with real, verified source cards. Harness 8/8.

**The broader principle, discussed and agreed with the founder before implementation:** this is not a rule to apply blanket across the app. Real, honest tradeoffs exist -- more engineering complexity per case, and real risk of feeling robotic if misapplied to narrative/subjective content (research explicitly warns determinism is "unsuitable for tasks like brainstorming, writing assistance, or conversational AI where variability is often desired"). The decision line agreed: use deterministic construction when a question has an objective, threshold-based membership test (utilization >= X%, score < Y, days overdue > Z) AND the qualifying set could plausibly run long (double digits) -- matching the empirical finding that RISK_FLAG=HIGH's 7-item list works reliably without this, but a 20-item list does not. Leave genuinely narrative/subjective content (risk assessment prose, news summaries) to the model's natural judgment, as today.

**Agreed next steps, not yet done:**
1. A quick audit (not a rebuild) of other places with the same shape of risk -- other objective-threshold, potentially-long-list question types across the app -- applying the same judgment call about whether the pattern is warranted, not applying it everywhere reflexively.
2. Automated repeated-run consistency testing added to the harness, so this class of bug (found today only via manual, repeated hand-testing) gets caught before a demo visitor encounters it, not after.

---

## List-completeness audit, part 1: root causes fixed for customers and credit_events (2026-09-02/03)

Follow-up to the utilization-list reliability work. Full code-level audit of every context section in cia-agent for the same shape of risk (objective, threshold-based criteria with no deterministic backstop). Findings and priority order captured; two of the highest-priority items fixed this session.

**Root cause #1 -- fn_rank_portfolio_risk() LIMIT 25 (commits 7a34824, 3556955).** The utilization fix shipped previously was narrowly scoped to a separate parallel scan; the general customers-table context section used by EVERY portfolio-wide question was still built from this RPC's ~25-of-59-row output. Checked the actual SQL before touching anything: the ORDER BY already sorts is_high_risk customers first, so the limit never affected the locked V1 rule itself (confirmed via dry-run: same 7 customers before and after) -- but it silently capped every other customer-level question (credit rating threshold, scenario, risk_tags, payment_health) and would have silently truncated the locked rule itself if the genuine high-risk set ever grew past 25. Removed the LIMIT entirely, since customers is a naturally bounded dimension (deliberately onboarded, not an accumulating log) -- confirmed live afterward with a new test (credit rating < 50, 24 genuinely qualifying customers including several that would have fallen outside the old cap) -- all 24 correctly named. This also let the utilization_scan_customers workaround be removed entirely (net simplification, not just a fix).

**Root cause #2 -- credit_events flat .limit(30) on an unbounded, growing fact table (commits 72b3ece, e79262d).** Found while investigating a live multi-signal-convergence question: Triumph Group Inc (3 distinct agents -- the strongest case in the portfolio) and Atlas Precision Manufacturing (2 agents) were both completely invisible, confirmed via direct query to have events ranking 32/33/35 -- past the row cap. Explicitly NOT fixed the same way as fn_rank_portfolio_risk -- credit_events grows without bound in a live product, so simply raising the limit would only delay the same failure, not fix it. Two-part fix instead: (1) fn_multi_signal_convergence(), a real GROUP BY + HAVING SQL aggregation -- correct at any table size, unlike inferring convergence from a possibly-truncated raw list -- surfaced as a new OFFICIAL MULTI-SIGNAL CONVERGENCE LIST section (M tag prefix); (2) replaced the row-count cap with a 90-day time window plus a generous 300-row backstop (a real, found reason to keep a backstop rather than time-window-only: initDemo.ts's reset path doesn't delete prior credit_events before re-invoking sensing agents, so repeated resets could in principle accumulate events over time if those agents aren't perfectly idempotent). Verified live: 3/3 runs correctly named all 4 genuinely qualifying customers (Triumph, Atlas Precision, plus two more the same bug had also been hiding -- Arconic, Heliogen), and no longer misclassifying single-agent-multiple-events customers (Cascade) as convergence, an accuracy improvement beyond just completeness.

**Full audit findings, remaining priority order (not yet fixed):**
3. Invoices' missing per-bucket counts -- v_ar_aging_current already computes bucket_1_30_count etc., just not selected; cheap to close.
4. CONFIRMED CLOSED, no dedicated deterministic list needed. Other customers categorical fields (scenario, risk_tags, payment_health membership questions) -- tested live: "which customers have payment_health flagged as at_risk" (22 genuinely qualifying customers) returned all 22/22 correctly across 3 consecutive runs, no misses. Root cause #1's fix (removing fn_rank_portfolio_risk's LIMIT 25) generalizes correctly to this and, by the same reasoning, to scenario/risk_tags questions -- no additional deterministic backstop needed for this item.
5. payment_transactions enumeration -- lower priority, existing aggregates already cover most realistic questions.

**Item #3 shipped (commit dbeb26b).** Exposed per-bucket invoice counts (current_count, bucket_1_30_count, etc.) alongside the existing dollar amounts, for both named-customer and sector AR aging totals -- v_ar_aging_current already computed these, they just weren't selected. Verified live: "how many of Arconic's invoices are 61-90 days overdue" correctly returns 2 (matching a direct query), and "how many invoices are 31-60 days overdue in the aerospace sector" correctly returns 9. Confirmed v_ar_aging_portfolio has no analogous count columns -- the true portfolio-wide invoice-count case remains a separate, unscoped gap, queued as the next fix. Harness 8/8.

**Portfolio-wide follow-up also shipped (commit 987cad7).** Extended v_ar_aging_portfolio with the same per-bucket invoice counts, appended at the end of its column list (Postgres's CREATE OR REPLACE VIEW only allows appending, not inserting mid-list -- confirmed the hard way via a dry-run error first). Verified live: "how many invoices total are 31-60 days overdue across the whole portfolio" correctly returns 22, matching the dry-run exactly. Item #3, including this follow-up, is now fully closed at every scope (named customer, sector, and portfolio-wide). Harness 8/8.

Also confirmed during this audit: negative_news, sec_filings, invoices, and payment_transactions all share the same "unbounded growing table with a flat row-limit" shape as credit_events did -- not yet fixed, logged as real, live risk for a future pass, same two-part pattern (deterministic aggregation for "how many/which" questions, time-window for general browsing) to be applied one table at a time with review at each step, not as one large combined change.

**Re-assessed with real data, found to be lower risk than originally flagged (2026-09-05).** Checked actual row counts before building anything: negative_news (5 rows, cap 10) and sec_filings (8 rows, cap 10) are both comfortably within their caps right now -- genuinely no current risk. invoices (160 rows, cap 20) and payment_transactions (472 rows, cap 30) are both actively over their raw-query caps -- but critically, unlike credit_events at the time of its bug, the dangerous failure mode (a wrong aggregate number, or a customer silently invisible to a totals question) is already fully closed for both, as a side effect of the AR aging views (v_ar_aging_current/_portfolio/_sector) and payment behavior views (v_payment_behaviour/_sector/_portfolio) built earlier -- confirmed by reading the actual system prompt instructions live: both raw tables are already explicitly restricted to "list or describe specific individual records... not to recompute aggregate totals," with the existing 15-item-list-plus-total-count exception already handling honest disclosure of partial browsing lists. The only remaining residual risk is a genuinely lower-stakes case (an incomplete browsing list of individual invoices/transactions, not a wrong number or an invisible customer), and it's already handled honestly rather than silently. Decision: do not build additional time-window/deterministic-aggregation work for these two tables now -- the real risk this whole audit exists to catch has already been eliminated as a side effect of other work, not left open. Revisit only if these tables grow to a scale where the "list individual records" browsing case itself becomes a real product concern, or if negative_news/sec_filings approach their caps as the demo/product grows.

**Incident during this work:** an `env | grep` command printed a live DATABASE_URL, including its password, into the session transcript. Founder rotated the credential immediately; connection reconfirmed working afterward. Added a standing CLAUDE.md rule (commit 9c0754d) against printing credential values in any future session.

Harness 8/8 maintained throughout.

---

## Closing the old "Phase 1d follow-up" audit gap list (2026-09-05)

The B0 Rebuild Plan's views audit originally flagged 6 items as needing follow-up verification "before declaring B0 done": bankruptcy_details table, growth_signals table, sec_monitoring table, invoices.claimable, invoices.next_dunning_date, payment_transactions.days_to_pay. Checked today whether all had actually been closed -- three had clear prior resolution already in this doc (sec_monitoring: extensively worked, closed with a systematic orphaned-row sweep; invoices.next_dunning_date: confirmed dropped cleanly; bankruptcy_details/growth_signals: confirmed dead code+schema). The remaining two had no explicit closure recorded anywhere -- verified directly rather than assumed:

- **invoices.claimable** -- only referenced by v_bankruptcy_claims (as claimable_invoice_count/claimable_total), the same view already confirmed dead/unused above. Falls into the same bucket -- confirmed dead, safe, logged for the same future schema-hygiene pass, not urgent.
- **payment_transactions.days_to_pay** -- confirmed genuinely live and actively used: read by ar-aging-agent, the analyse-payment-behaviour skill, cited directly in cia-agent's PAYMENT TRANSACTIONS TABLE context and payment-behavior sections, and displayed in the frontend (CustomerDetail.tsx). Never actually a gap -- just missing an explicit "confirmed fine" note.

All 6 items from that original list are now genuinely accounted for. This closes out the last open item from the B0 views audit.

---

## Two pre-existing frontend rendering bugs found during the About page consolidation (2026-09-09)

Found while building the new "What is this?" page, both affecting the live CIA page too, not just the new work.

**Bug 1: @tailwindcss/typography never registered (commit 8a91453).** Installed as a devDependency, but tailwind.config.ts's plugins array only had tailwindcss-animate -- meaning every "prose" class used across the app (both the new About.tsx and the existing CIA.tsx answer rendering) generated zero actual CSS. Confirmed with real evidence, not assumption: compiled CSS grew from 41.45kB to 60.76kB after registering the plugin, and the specific .prose h2 rule (font-weight:700, font-size:1.5em) was confirmed present in the build output afterward.

**Bug 2: remark-gfm never installed (commit 500c5ce).** react-markdown doesn't parse GitHub-flavored markdown (tables, strikethrough, task lists, autolinks) without this plugin explicitly wired in. Found via a live screenshot: a CIA answer containing an AR aging summary table rendered as one long line of literal pipe-and-dash text instead of an actual table. Installed as a real (non-dev) dependency and wired into both CIA.tsx and About.tsx. Verified the compiled CSS already contained @tailwindcss/typography's table styling rules before assuming tables would render formatted once parsing worked.

Net effect: CIA's answer formatting (headings, bold text, tables) has likely been rendering with meaningfully less structure than intended since whenever these dependencies were first added but never fully wired in -- this wasn't a regression introduced by new work, it was pre-existing and just hadn't been visually scrutinized closely enough to notice until this session's screenshot review.

---

## Deferred to v3/v4: composite-risk/briefing pipeline is silently broken (found 2026-09-09, during the README accuracy audit)

Found while verifying README claims against the live database: cia-agent's briefing mode writes credit_events with event_type = 'DAILY_BRIEFING', 'COMPOSITE_RISK_CRITICAL', and 'COMPOSITE_RISK_ELEVATED' -- none of which are in the actual event_type CHECK constraint on credit_events (confirmed live: baseline.sql matches the live constraint exactly, and none of these three values are present). The insert error is only console.error'd, never surfaced anywhere -- confirmed via direct query that zero rows of any of these three types exist among the 47 total credit_events rows. This means the entire composite-risk-scoring and daily-briefing-persistence pathway has likely never actually worked in this deployment's history, silently.

Also found in the same audit pass: 5 of assess-composite-risk's 13 unit tests are currently failing (e.g. expects a threshold of 65, code returns 75) -- a real, live regression independent of the above, in the same feature area.

Founder's call: this is real work, but not urgent -- v3/v4 scope, not pre-audit blocking work. README.md has been corrected to stop describing this as working functionality (the How It Works diagram and the CIA agent's own description both previously claimed it), so the documentation is now honest about current state rather than aspirational.

When this is picked up: fix or extend the event_type CHECK constraint to include the intended values (or rename them to something already permitted, whichever is the better long-term taxonomy decision), fix the 5 failing assess-composite-risk tests (check whether the code or the tests have the wrong threshold), and verify end-to-end that a real briefing run successfully persists its events before considering this done.

---

## README accuracy audit, two passes (2026-09-10)

Full README.md audit ahead of external engineer review, done in two passes since the first pass's own coverage turned out to be incomplete (found when the founder specifically questioned the Data Ingestion section, which the first pass hadn't checked).

**Pass 1 (commit 79acedc):** aligned README's tone with the new "What is this?" page (dropped marketing framing), replaced the About section with one consistent bio, and fixed several factual errors found via targeted spot-checks: AR Aging Agent falsely claimed to compose Teams alerts, SEC agent's signal-type count was inflated (15 vs real 10), migrations section claimed a single-migration schema when 10 real files exist, customer_identifiers was missing from Key Tables despite being discussed elsewhere in the same doc, and the Testing section implied a clean test pass when 5 tests are actually failing. Also found and deferred (not README-specific): the entire composite-risk/briefing event-writing pathway is silently broken -- DAILY_BRIEFING/COMPOSITE_RISK_CRITICAL/COMPOSITE_RISK_ELEVATED aren't in the actual event_type CHECK constraint, so every insert has failed silently, confirmed via live query (zero such rows exist among 47 total events). Removed these claims from the How It Works diagram and CIA's own description rather than continue documenting broken functionality as real. Founder's call: defer the actual fix to v3/v4, not pre-audit blocking.

**Pass 2 (commit b69ea6d), prompted by the founder questioning one specific section rather than accepting pass 1 as complete:** a genuinely thorough, section-by-section re-verification surfaced several more errors, two of them meaningfully serious privacy-adjacent claims, not just staleness:

- **Most serious:** Data Residency claimed "invoice numbers, internal account IDs, and payment transaction details are never sent to the Anthropic API." Confirmed false by reading cia-agent/index.ts directly -- both ARE included in question-answering context when relevant to a question. Corrected to state this plainly rather than continue the false reassurance.
- Also false: "only the CIA and dunning letter agents make external API calls." Confirmed there is no dunning letter agent at all -- compose-dunning-letter.ts is a built skill never imported by any of the 5 real agent functions. News Monitor genuinely does call Anthropic directly (already stated two lines below the false claim, in the same document's own data table) but wasn't named in the prose.
- Customer Master Data table listed 4 fields (customers has 44 real columns) and got required-ness backwards -- claimed company_type was required (it's nullable, defaults to 'public'); sector is the actual required field with no default, and wasn't mentioned at all.
- AR CSV upload cannot create customer records -- confirmed directly in ar-csv-upload/index.ts (matches existing customers only, reports unmatched_customers). Two places in README falsely implied otherwise (the V1 setup bullet, the DATA IN diagram).
- The EXECUTED diagram named the wrong table for the action audit trail (said credit_events, actual table per Actions.tsx's approval mutation is credit_actions).
- Getting Started's agent-deploy step was missing ar-csv-upload -- following the documented 4 commands exactly leaves the live AR upload button broken.
- The Security section's pre-production lockdown checklist named 3 of 7 tables that actually have anon write policies today -- added the missing 4 (agent_runs, credit_events, negative_news, sec_monitoring).

**Lesson for future doc audits:** a first pass built from a specific list of things-to-check, however careful, is not the same as full section-by-section coverage -- pass 1's list came from the founder's own read-through plus obvious candidates, and still missed an entire section (Data Ingestion) along with the two most consequential findings of the whole exercise. Worth defaulting to full-document coverage rather than a curated checklist when the stakes include privacy-adjacent claims.

---

## Demo data-integrity vulnerability found and fixed (2026-09-11)

Found while explaining the AR CSV upload flow to the founder in response to a question about what actually happens on upload. Real risk, not theoretical: ar-csv-upload matches rows to existing customers via DUNS or internal_customer_code only. All 59 demo customers have a seeded internal_customer_code, and supabase/seed.sql's own comment documents the exact generation pattern in plain English ("sequential CUST-NNN codes for all 59 customers, alphabetical by company_name") -- now publicly readable in the fresh public repo. A successful match deletes that customer's existing open/overdue invoices before inserting the uploaded rows (confirmed in ar-csv-upload/index.ts). Since the hosted demo is a single shared instance, not per-visitor, anyone could have crafted a CSV using the documented pattern and corrupted the AR data every other visitor sees -- with no automatic recovery, since the Reset Demo button only resets pending_actions and a few processed flags, it doesn't reload invoices from seed.

Fixed (commit 8814cf8): the "Upload AR Data" button stays visible for discoverability, but the modal shows an explanatory message instead of the upload form when DEMO_MODE is true, gated at the top of the dialog so the later mapping/success steps are structurally unreachable, not just visually hidden. Verified live.

Worth noting for whoever picks up further demo-hardening work: this was found by walking through the actual code path in detail while answering a question, not by a dedicated security review -- worth considering whether other demo-writable endpoints (anything hit by a POST from an unauthenticated visitor) deserve the same kind of walkthrough before the demo sees wider traffic.
