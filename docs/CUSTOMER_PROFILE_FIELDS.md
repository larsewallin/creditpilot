# CreditPilot — Customer Profile Fields (V1 → V2 plan)

**Status:** Schema fully applied — all 9 new columns plus the `tax_id` identifier-type constraint are live (migration `20260828000000_customer_profile_fields.sql`, commit 29e8bc6). Design locked for onboarding-form fields. The "Add Customer" UI that will populate these fields is deliberately deferred to its own future session (already logged, 2026-08-16). Onboarding-workflow fields (Section 6) are V2/V3, logged not built.
**Decision date:** 2026-08-27
**Scope:** The complete reference for every field that makes up a customer's profile — combining the existing `customers`/`customer_identifiers` schema with the new onboarding template — and where each one lives.

---

## Why this exists

The customer profile has grown piecemeal: some fields exist because they were needed for the demo, some because an agent needed somewhere to write its output, and some because a real customer-onboarding template surfaced gaps the schema never had. This doc reconciles all three into one reference, and records the reasoning behind the additions — matching the "the Base must be solid before more agents get built on it" principle already established for this project.

---

## Two kinds of fields

A customer profile has two genuinely different categories, and this doc keeps them visually and structurally separate:

1. **Onboarding fields** — entered once (or occasionally corrected) by a human when a customer is created. This is what the new `Customer_Onboarding_Template.xlsx` covers.
2. **System-computed fields** — written continuously by agents (AR aging, CIA, future rating/payment agents). These don't belong on an onboarding form — a brand-new customer has none of them yet — but they're still part of the full profile, and nothing about them changes in this doc.

---

## 1. Identity & Identifiers

| Field | Status | Notes |
|---|---|---|
| CreditPilot ID | Existing (`customers.id`) | System-generated UUID. |
| DUNS | Existing concept, **elevated to its own dedicated field** | Was previously just another row in `customer_identifiers`; given its status as the primary, globally-applicable identifier (per the original Identifier Strategy doc), it now gets first-class placement on the onboarding form. |
| Internal Customer ID | Existing (`internal_customer_code`), **elevated to its own dedicated field** | "The customer's own internal code in their ERP for this entity" — already documented as the future ERP-sync key. Nearly every enterprise customer will have one, so it gets the same prominence as DUNS. |
| Additional Identifier (type + value) | Existing table (`customer_identifiers`), **vocabulary expanded** | Covers CIK, LEI, ticker, and now **tax_id** (new — not previously in the `id_type` CHECK constraint). The onboarding template captures one additional identifier at intake; a customer needing more than one gets the rest added after onboarding, through the app itself (see "Add Customer" below). |

**Schema change applied:** `customer_identifiers.id_type`'s CHECK constraint now includes `'tax_id'` (`duns`, `ticker`, `cik`, `lei`, `internal_customer_code`, `tax_id`) — added by migration `20260828000000_customer_profile_fields.sql` (commit 29e8bc6). The "Add Customer" feature (already logged separately in the deferred backlog, 2026-08-16) can rely on this constraint already accepting `tax_id`.

---

## 2. Company Details

| Field | Status | Notes |
|---|---|---|
| Company Name (Legal) | Existing (`company_name`) | The officially registered legal name. |
| International Business Name | **New** | The name used internationally, when different from the legal name (e.g. different script/language). Directly relevant to the multi-language CIA work already logged. |
| Trade Name (DBA) | **New** | A distinct concept from both of the above — an operating/brand name a company does business under, which can differ from its legal name entirely (e.g. a parent company operating a retail brand under a different name). |
| Website | **New** | |
| Sector | Existing (`sector`) | CHECK-constrained to 7 values; unchanged. Added to the onboarding template since every customer needs one assigned at creation. |
| Industry | Existing (`industry`) | Free-text sub-industry; unchanged. |
| NAICS/SIC Code | **New** | Standard industry classification code, distinct from the free-text `sector`/`industry` fields already in place. |

---

## 3. Address

| Field | Status | Notes |
|---|---|---|
| Street Address | **New** | |
| City | **New** (structured) | Previously only existed inside the free-form `headquarters` text field ("Chicago, IL"). |
| Postcode | **New** | |
| Country | Existing (`country_code`) | ISO 3166-1 alpha-2. Unchanged. |

**Decision: `customers.headquarters` is deprecated.** Now that City/Street/Postcode/Country exist as real structured fields, the old free-form display-only field is redundant and would drift, matching this project's own established pattern (every duplicated field eventually goes stale). Removal is a schema migration, not applied this session — needs to happen alongside the "Add Customer" build, with a one-time backfill of the new structured fields from the existing `headquarters` text for current customers before the column is dropped.

---

## 4. Financial / Credit Terms

| Field | Status | Notes |
|---|---|---|
| Credit Limit | Existing (`credit_limit`) | |
| Invoicing Currency | **New** | The customer's invoicing currency specifically (confirmed with founder) — feeds directly into the already-logged V2 multi-currency effort (backlog item D1d). Not multi-currency support itself; just the field that eventually needs it. |
| Payment Terms | Existing (`payment_terms_days`) | |
| Credit Rating (raw) | Existing (`credit_rating_raw`) | e.g. "BB+". |
| Credit Rating (score) | Existing (`credit_rating_score`) | Normalized 0-100. |
| Credit Rating Source | Existing (`credit_rating_source`) | |
| Credit Rating Last Updated | Existing (`credit_rating_updated_at`) | Confirmed with founder: this field already means what was being asked for ("latest rating update date") — no new field needed, just documenting the mapping clearly. |

---

## 5. Ownership / Contacts

| Field | Status | Notes |
|---|---|---|
| Account Manager | Existing (`account_manager`) | |
| Credit Manager | **New** | A distinct role from Account Manager — nothing like this existed before. |
| User Comment | Existing (`notes`) | |

---

## 6. Onboarding & Compliance — V2/V3, explicitly not built now

A real onboarding workflow needs more than a single approval checkbox. Captured here for future planning, matching the project's "log the idea, don't build speculatively" principle:

- **Onboarding status** — a real state, not a boolean: draft → pending review → approved / rejected / needs more info
- **Approved by** + **Approved date**
- **KYC/compliance check status** — genuinely separate from general onboarding approval; sanctions/watchlist screening is its own workflow with its own pass/fail state
- **Onboarding source** — how the record was created: manual entry, CSV bulk import, future ERP sync
- **Onboarding date** — when the system record was first created (distinct from the existing `customer_since`, which is about when the *business relationship* started, not when the record was made)

This connects directly to the previously-logged priorities: the KYC/onboarding/fraud agent direction, and the "Add Customer" feature (its own dedicated session, logged 2026-08-16) — the two should be designed together, not independently.

---

## 7. System-computed / agent-written — unchanged, not part of the onboarding form

Listed here only so nothing looks lost — none of these change as a result of this doc, and all are already documented in full in `CreditPilot_Demo_Data_Contract.md`:

`current_exposure` (and derived utilization %), `credit_rating_previous_score`, `risk_tags` + `risk_tags_updated_at`, `payment_on_time_rate`, `payment_avg_days_early_late`, `payment_trend`, `payment_health` + `payment_behaviour_updated_at`, `scenario` (demo-only).

---

## What's NOT changing / staying deprecated

- `customers.ticker`, `customers.sec_cik` — already deprecated in favor of `customer_identifiers`, per the locked Identifier Strategy doc. Unaffected by this work.
- `customers.flags` — already deprecated (pre-V1 taxonomy cruft). Unaffected.
- `customers.customer_since` — stays as-is, distinct from the new "Onboarding date" concept above.

---

## Deliverables from this session

1. **`Customer_Onboarding_Template.xlsx`** — the fillable onboarding template itself, combining the founder-provided template with every addition above. Includes a legend sheet and one example row.
2. **This document** — the durable rationale and field-by-field mapping, for the project's permanent record.

## Not done this session (real follow-up work)

- The `headquarters` deprecation migration + backfill
- Building the actual "Add Customer" UI that this template's fields will eventually populate (already its own logged, dedicated session)
- Any of the Onboarding & Compliance (Section 6) fields as real schema/UI
