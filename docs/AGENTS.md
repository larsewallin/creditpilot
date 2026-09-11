# Agent Documentation

CreditPilot currently ships with four autonomous agents — more are expected as the system grows (see 'Extending this system' at the end of this doc). Each is a Supabase Edge Function (TypeScript/Deno). They read from and write to a shared Postgres database. `credit_events` is written exclusively through `publishEvent` (a validating gateway — payloads are checked against per-event-type Zod schemas before insert). Proposed actions (`pending_actions`) are written only by the CIA agent; a human reviews them before anything takes effect.

All three monitoring agents (AR, News, SEC) share a common shape, established with the SEC agent as the reference implementation:

- **Rate limit**: reject if a completed/running run exists within the past 60 minutes.
- **DEMO_MODE self-reset**: at the start of a run, if `DEMO_MODE=true`, the agent clears its own prior demo-tagged output first, so repeated demo runs regenerate a clean, repeatable result instead of stacking duplicates. Production never self-deletes.
- **Data-source boundary**: for News and SEC, demo vs. live is decided at a single fetch point (seed table vs. live API); everything downstream — processing, emission, notification — is identical code in both modes. AR aging has no such split; its data (invoices) lives in Postgres either way, so `DEMO_MODE` only stamps output and gates the reset.
- **Every emitted event and message is stamped `is_demo: DEMO_MODE`.**

---

## AR Aging Agent (`ar-aging-agent`)

### What it does

Reads current AR aging state per customer and emits two kinds of signal:

- **Utilization breaches** — when a customer's credit utilization is over-limit, or high utilization combines with a weaker credit signal (utilization alone is not treated as risk).
- **Overdue AR** — a per-customer aggregate of overdue balance (not per-invoice — per-invoice would be noisy at scale). One event per affected customer, summarizing total overdue, the four aging buckets, invoice count, and oldest days overdue.

It also refreshes the payment-behaviour fields on `customers` (on-time rate, average days early/late, trend, health classification) — AR is the sole writer of these fields; the CIA and other consumers read them but do not write them.

**Not yet built:** dunning letter composition and the over-90 Teams alert. The `compose-dunning-letter` skill exists but is not invoked by this agent — overdue detection is live; the notification/escalation phase that would consume it is still on the roadmap.

### Trigger

Manual (Run Agent button in the AR Aging page), programmatic, or implicitly whenever new AR data lands via CSV upload (the upload function refreshes the underlying snapshot the agent reads, but does not itself trigger an agent run).

### Data sources

- `v_ar_aging_current` — latest AR aging snapshot per customer
- `invoices` — for overdue-bucket aggregation
- `payment_transactions` — last N payments per customer, via the `analyse-payment-behaviour` skill

### Outputs

| Table | Event type | Condition |
|-------|-----------|-----------|
| `credit_events` | `UTILIZATION_THRESHOLD_BREACH` | Over-limit, or high utilization + weak credit signal |
| `credit_events` | `OVERDUE_AR` | Customer has any active overdue invoices (excludes paid/written-off/pre-petition) |
| `customers` | `payment_on_time_rate`, `payment_avg_days_early_late`, `payment_trend`, `payment_health` updated | Every run |
| `agent_runs` | run audit record | Every execution |

### Severity logic

**UTILIZATION_THRESHOLD_BREACH:** `critical` if over-limit, `high` otherwise.

**OVERDUE_AR:** scales with the worst non-empty aging bucket — over-90 → critical (score 92), 61–90 → high (75), 31–60 → medium (55), 1–30 → low (30).

### Rate limit

60 minutes between completed/running runs.

---

## News Monitor Agent (`news-monitor-agent`)

### What it does

Runs a live news pipeline per customer:

1. Searches for news via Tavily.
2. Deduplicates by content fingerprint against `negative_news.content_fingerprint`.
3. Classifies each new article with Claude (confidence score + severity).
4. Skips articles below the confidence threshold (`CONFIDENCE_THRESHOLD = 0.7`) for event/alert purposes — they're still recorded in `negative_news`, just not escalated.
5. Inserts qualifying articles into `negative_news`.
6. For medium/high/critical severity, emits a credit event and composes a Teams alert.

In demo mode, the fetch step reads from a seed table instead of calling Tavily live; all classification and emission logic downstream is unchanged.

### Trigger

Manual (Run Agent button in the News Monitor page) or programmatic.

### Data sources

| Source | Description |
|--------|-------------|
| `customers` | Portfolio customers to search for |
| Tavily API (live) / seed table (demo) | Article source |
| Anthropic API | Article classification |
| `negative_news` | Fingerprint dedup check before insert |

### Outputs

| Table | Event type | Condition |
|-------|-----------|-----------|
| `negative_news` | New article row | Passes dedup check |
| `credit_events` | `NEWS_EVENT` | Passes confidence threshold; severity is carried as a field on the event, not encoded in the type name |
| `agent_messages` | Teams alert | Medium/high/critical article, event successfully written |
| `agent_runs` | run audit record | Every execution |

### Rate limit

60 minutes between completed/running runs.

---

## SEC Filing Monitor Agent (`sec-monitor-agent`)

### What it does

Fetches recent filings for monitored customers directly from SEC EDGAR (free, no API key) and scans filing text for risk language:

1. Calls EDGAR's submissions API for recent 10-K/10-Q/8-K filings.
2. Fetches each filing's primary document and scans for risk keywords.
3. Deduplicates by `accession_number` (globally unique across all EDGAR filers) — skips filings already in `sec_filings`.
4. Writes `sec_filings` for every new filing, whether or not it carries a risk signal.
5. For filings with risk signals: emits a credit event and composes an alert.

In demo mode, the fetch step reads from a seed table instead of calling EDGAR live.

### Data sources

| Source | Description |
|--------|-------------|
| `sec_monitoring` | Monitored customers |
| `sec_filings` | Dedup check by accession_number |
| SEC EDGAR API (live) / seed table (demo) | Filing source |

### Risk keywords detected

The full, current keyword-to-signal mapping lives in `supabase/functions/_shared/skills/integration/fetch-sec-filing.ts` (`RISK_KEYWORDS`) — check that file directly rather than this doc for the authoritative list, since it's the kind of detail that drifts easily. As of this writing it includes going-concern language, covenant waivers/breaches, CEO departure language, cash runway, material weakness, restatement, SEC investigation, pension underfunding, strategic review, and revenue miss.

### Outputs

| Table | Event type | Condition |
|-------|-----------|-----------|
| `sec_filings` | Filing row | Every new filing |
| `credit_events` | `GOING_CONCERN` | Going-concern language detected — confirmed `critical` severity (score 92) |
| `credit_events` | `SEC_OTHER` | Other risk signals — a deliberate catch-all. Covenant waiver, CEO departure, and revenue miss have dedicated typed events defined in the taxonomy (`COVENANT_WAIVER`, `CEO_DEPARTURE`, `REVENUE_MISS`) but the structured extraction needed to populate their specific fields isn't built yet, so these currently emit as `SEC_OTHER` with a `concern_category` field as a stopgap. |
| `agent_messages` | Alert | Each filing with risk signals |
| `sec_monitoring` | Tracking fields updated | After processing |
| `agent_runs` | run audit record | Every execution |

### Rate limit

60 minutes between completed/running runs.

---

## Credit Intelligence Agent (`cia-agent`)

### What it does

Synthesises signals from the three monitoring agents into structured intelligence, in three modes:

| Mode | Model (live) | Model (demo) | Purpose |
|------|--------------|---------------|---------|
| `briefing` | `claude-opus-4-5` | — | Portfolio summary; processes unread credit_events; runs credit-limit decisioning |
| `question` | `claude-sonnet-4-20250514` | `claude-haiku-4-5` | Answers a specific question with cited, deterministic sources |
| `suggestions` | `claude-haiku-4-5` | `claude-haiku-4-5` | Generates follow-up questions from recent events |

(Model identifiers current as of this writing — check `cia-agent/index.ts` directly if precision matters, as these are the kind of detail that changes without a doc update.)

### Sources are deterministic, not LLM-generated

Sources shown alongside an answer are built in code from the actual matched records (`credit_events`, `negative_news`, `sec_filings` — matched by keyword relevance to the question, not an unfiltered dump). This was a deliberate fix for two earlier problems: sources intermittently coming back empty due to a flaky second LLM call, and sources occasionally being fabricated by that call. Neither is possible now — a source shown to the user always corresponds to a real row.

### Credit limit decisioning (briefing mode)

Runs `assessCompositeRisk` (flags customers with corroborating signals across multiple agents) and `calculateCreditLimitProposal` (determines whether to propose a reduction, and by how much) per at-risk customer. Where a proposal results, it's written to `pending_actions` — the CIA is the sole writer of this table.

### Outputs (briefing mode)

| Table | Event type | Condition |
|-------|-----------|-----------|
| `credit_events` | `DAILY_BRIEFING` | Every briefing run |
| `credit_events` | `COMPOSITE_RISK_CRITICAL` / `COMPOSITE_RISK_ELEVATED` | Customer flagged by multiple agents' signals |
| `credit_events` | Source events marked `cia_processed = true` | After processing |
| `pending_actions` | Proposed action | `assessCompositeRisk` + `calculateCreditLimitProposal` recommend one |
| `agent_runs` | run audit record | Every execution |

### Question mode response shape

```json
{
  "answer": "Markdown-formatted analysis",
  "sources": [
    {
      "event_id": "uuid",
      "customer_name": "string",
      "event_type": "string",
      "severity": "critical|high|medium|low|info",
      "date": "ISO date string",
      "agent": "string"
    }
  ],
  "confidence": "High|Medium|Low",
  "confidence_reason": "One sentence"
}
```

### Rate limit

60 minutes between completed/running runs.

---

## Event taxonomy

`credit_events` rows share these fields:

| Field | Description |
|-------|-------------|
| `event_type` | SCREAMING_SNAKE_CASE signal identifier — see per-agent tables above for what's actually emitted today. The full V1 taxonomy (29 types) includes many not-yet-built agents; `docs/EVENT_TAXONOMY.md` is the authoritative full list. |
| `source_agent` | `ar_aging_agent`, `news_monitor_agent`, `sec_monitor_agent`, `cia-agent` |
| `severity` | `critical`, `high`, `medium`, `low`, `info` |
| `severity_score` | 0–100, **higher = worse** (opposite convention from `customers.credit_rating_score`, which is 0–100 lower = worse — these are deliberately different scales; see the data contract doc) |
| `scope` | `customer` or `portfolio` |
| `cia_processed` | `false` until the CIA has synthesised the event into a briefing |
| `is_demo` | `true` for seed/demo-generated data, `false` for live |
| `correlation_id` | Groups corroborating events; root events have `correlation_id` = their own id |
| `parent_event_id` | Cascade tracking, where applicable |

---

## Extending this system

New agents follow the same shape described above — see `CONTRIBUTING.md` for the concrete steps (rate limiting, DEMO_MODE handling, `publishEvent` usage, `is_demo` tagging). Because every monitoring agent's only contract with the rest of the system is "write valid events to `credit_events`," the CIA and frontend require no changes to benefit from a new agent's output once it's emitting correctly.
