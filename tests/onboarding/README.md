# Onboarding golden-prospect harness

14 fictional applicants whose correct outcome was decided **before** any
onboarding code was written. The real pipeline core
(`supabase/functions/_shared/onboarding/pipeline.ts`) runs each one with
fixture providers instead of live registries, sanctions lists, Keen, EDGAR
and macro agents, so the whole decision path is tested offline.

    node tests/onboarding/run.mjs

No Supabase, keys or network needed. Results go to `results/latest.json` (git-ignored).

**Gate:** from the end of Phase 1, onboarding code is committed only with
14/14 here **and** CIA 8/8 (`node tests/cia/run.mjs`). Until then the
harness is expected to fail (Phase 0: 0/14).

## The cases

| # | Prospect | Expected outcome |
|---|---|---|
| G01 | Clean private US distributor, reviewed statements | Counteroffer $30k (asked $35k); working capital binds after the 15% reviewed haircut |
| G02 | Strong private US | Approve $80k + "higher limit supportable up to $200k" |
| G03 | Request above balance-sheet caps | Counteroffer $125k (asked $500k); working capital binds |
| G04 | Missing credit score (no statements or third-party score) | Incomplete; names it; Reg B 30-day clock |
| G05 | Director close to a sanctions-list name | Screening review; hit open until a person decides |
| G06 | Entity on a sanctions list | Screening fail; decline proposed to a person only |
| G07 | 4-month-old company, 2-month-old website, virtual office, $150k | Screening review with 3 fraud flags |
| G08 | No financials, bureau report only (Keen: insufficient data) | Bureau report used; approve $45k + higher-limit note |
| G09 | Public US company | SEC EDGAR financials; approve $750k + note |
| G10 | German company, EUR invoicing | DE + EUR signals → 20% haircut → counteroffer $200k (asked $220k) |
| G11 | UK Ltd | Companies House + PSC owners (3 people) + HMRC VAT; approve $100k + note |
| G12 | Already a customer (same tax ID) | No duplicate; routed to limit-increase review |
| G13 | Keen times out | Falls back to bureau score, memo says so; approve $50k + note |
| G14 | Compiled statements only | 30% haircut → counteroffer $70k (asked $75k) |

Each fixture's `why` field shows the arithmetic. All names, IDs and
sanctions-list entries are invented; the real-data smoke run (separate, not
a commit gate) uses the real lists and real public companies.

## Default policy the answers are based on

Defaults live in `_shared/onboarding/settings.ts`; they are part of the company's
Trade Credit Policy and editable per company.

**Completeness**
- Private companies requesting more than $250,000 need a credit score: Keen (statements) or a third-party score or rating.
- Personal guarantee required for sole proprietors and entities younger than 24 months.
- An existing customer (matched on DUNS, tax ID or registration no.) stops here and is routed to a limit review.

**Screening**
- Entity plus every officer, director, owner and guarantor (application + registry, de-duplicated, case-insensitive) is screened against the OFAC, EU, UK and UN lists.
- Name similarity (Jaro-Winkler and Soundex, best over the list name and every alias, as OFAC Sanctions List Search does) ≥ 0.99 plus a second identifier (country for an entity; country and year of birth for a person) → hit → fail. Every word of the applicant name must have a counterpart in the list name. From 0.85 up, or a near-exact name without the second identifier → review. Weak aliases ("low quality" on the UK and UN lists) are not screened. A person must dispose of every hit; the agent never clears one.
- Fraud flags: young entity (< 24 months) asking > $100,000; website domain < 12 months old; virtual/residential/PO-box address; registry formation date ≠ stated date; not found in registry. Two or more flags → review.

**Limit**
- Score labels (CreditPilot's one scale): Very strong 85+, Strong 70–84, Adequate 55–69, Watch 40–54, Elevated risk 25–39, High risk < 25. Multipliers: Very strong, Strong, Adequate 1.00; Watch 0.80; Elevated 0.50; High risk 0.
- Trade references, judged after scoring and shown to the approver: revenue $500M+ none; $25M–$500M 2; under $25M or unknown 3; one fewer for Strong or better.
- Score source order: Keen, then uploaded bureau report. The first source with a score counts (never an average); every fallback is recorded.
- Financials: SEC EDGAR for public companies, uploaded statements otherwise.
- Needs = monthly purchases × (terms ÷ 30) × 1.15.
- Caps = lowest of 10% of working capital, 10% of net worth (both reduced by the statements' haircut: audited 0%, reviewed 15%, compiled and tax return 30%, management 50%), and the bureau's maximum credit recommendation.
- Risk-adjusted cap = cap × score multiplier × 0.80 if the Country or FX agent has a high/critical signal for the prospect's country or invoicing currency (applied once).
- Supportable = risk-adjusted cap, rounded down to $5,000.
- Recommended = lower of needs and the risk-adjusted cap, rounded down to $5,000. The binding method is whichever is lower before rounding.
- Request ≤ recommended → approve as requested; otherwise counteroffer at recommended.
- Higher-limit note when supportable ≥ 1.2 × request. Never auto-grants more than requested.
- Every proposal needs a person to approve (`human_required: true`).

**Reason codes used so far:** `HIGHER_LIMIT_SUPPORTABLE`, `LIMIT_CAPPED_WORKING_CAPITAL`, `MACRO_COUNTRY_RISK`, `MACRO_FX_RISK`, `STATEMENT_QUALITY_COMPILED`, `SCORE_FALLBACK`, `SANCTIONS_MATCH`.

## Changing an answer

If the founder disagrees with a memo or an outcome, change the fixture's
`expect` (and `why`) first, then the code. A disagreement found in memo
review becomes a new case (G15, G16, …).
