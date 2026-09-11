# CreditPilot — Demo Data Input Contract (V1)

**Status:** Locked design.
**Decision date:** 2026-06-02
**Scope:** Defines the formal contract for data entering CreditPilot from external sources. V1 has one input flow: AR Aging CSV upload.

---

## Why this exists

Customers onboard into CreditPilot by uploading their AR aging report. Their ERP/accounting system exports the data in some format; CreditPilot's parser maps it to internal fields. This contract documents what the parser accepts, requires, and rejects — so:

- Customer onboarding teams know what their CSV must contain.
- The parser's behavior is documented, not implicit-in-code.
- Future inputs (payment uploads, customer onboarding CSV, etc.) extend this contract rather than reinventing it.

**Internal field names are not user-facing.** A customer's CSV column named "Balance" or "Outstanding" or "Open Amount" all map to internal `outstanding_amount`. The parser translates; users use their natural ERP format.

---

## V1 Input flows

**Available in V1:** AR Aging CSV upload (via `parse-ar-csv` skill + `ar-csv-upload` function).

**NOT available in V1:**
- Customer record upload (customers created manually for V1).
- Payment transactions upload (computed from AR + payment data over time, not directly uploaded).

V2/V3 plans for these flows TBD.

---

## AR Aging CSV — V1 Contract

### Required fields

Every row must provide these. Missing required fields → row rejected with error.

| Internal field      | Meaning                                                        | Accepted header variants |
|---------------------|----------------------------------------------------------------|--------------------------|
| `invoice_number`    | Unique identifier for the invoice                              | invoice_number, invoice #, invoice id, doc number |
| `customer_name`     | Customer's company name (used for lookup — see Identifier Strategy) | customer, customer name, account, account name, client |
| `invoice_date`      | Date invoice was issued (ISO 8601: YYYY-MM-DD)                 | invoice_date, date, issue date, doc date |
| `due_date`          | Payment due date (ISO 8601: YYYY-MM-DD)                        | due_date, due, payment due, maturity |
| `outstanding_amount`| Unpaid balance on this specific invoice. Positive number. Currency: USD-only V1. | outstanding, balance, open amount, remaining, outstanding amount, open balance, balance due, outstanding_amount |

### Optional fields

Accepted if present, defaulted/skipped if absent.

| Internal field      | Meaning                                                        | Accepted header variants | Default if missing |
|---------------------|----------------------------------------------------------------|--------------------------|-----|
| `amount`            | Original invoice gross amount (before any payments)            | amount, invoice amount, gross amount, total, original amount, gross | NULL — validation warning if outstanding > amount can't be checked |
| `currency`          | Currency code (ISO 4217). Must be 'USD' in V1.                 | currency, ccy, curr | 'USD' |
| `days_overdue`      | Days past due_date as of upload. Auto-computed from due_date if absent. | days_overdue, overdue, past due, age | computed from due_date vs upload date |
| `status`            | Invoice status (current/overdue/paid/disputed/etc.)            | status, state | derived from days_overdue: ≤0 → 'current', >0 → 'overdue' |
| `payment_terms`     | Free-form notes (e.g. "Net 30")                                | payment_terms, terms | NULL |

### Validation rules

**Hard rejects (row not loaded):**
- Missing any required field
- `outstanding_amount` non-numeric or negative
- `invoice_date` or `due_date` unparseable
- `due_date` before `invoice_date`
- Currency present and ≠ 'USD' (V1)

**Soft warnings (row loaded with warning):**
- `outstanding_amount > amount` (overpaid? data error? — loaded but flagged)
- `outstanding_amount` is exactly 0 with status not in ('paid', 'written_off')

**Customer lookup:** see Customer Identifier Strategy doc. V1 behavior: if customer_name doesn't match an existing customer in the system, the entire upload is rejected with an "unknown customer" error. Auto-creation deferred to V2/V3.

### Field semantics — what "outstanding" actually means

This is the most important definition to pin, because it varies by ERP:

**CreditPilot definition:** `outstanding_amount` = the unpaid portion of this specific invoice as of the upload timestamp. It is the amount the customer still owes on this invoice. Not including late fees or interest. Not net of any disputed amounts.

This matches the typical interpretation in QuickBooks ("Balance"), Xero ("Outstanding"), SAP ("Amount Due"). It does NOT match systems that include late fees in this figure — customers using such systems should strip those out before upload (a real customer-onboarding TODO, not handled by V1 parser).

---

## Currency rule (V1)

**USD-only.** All amounts treated as US dollars. The `currency` column on invoices has a default of 'USD'; the parser rejects rows with currency ≠ 'USD'.

No customer-level `default_currency` field in V1. No multi-currency aggregation. No FX conversion.

**V2 (planned, D1d in backlog):** real multi-currency support. When added, currency handling must be correct EVERYWHERE — invoices, exposure aggregation, snapshot buckets, FX exposure events, CIA answers, dashboard displays. Half-measures are not acceptable.

---

## Country rule (V1)

**Country is assigned at customer creation, not from upload.** AR aging upload does NOT carry a country field. Each customer in the database has a `country_code` (ISO 3166-1 alpha-2) set at creation time based on their company address. The country is verifiable against postal/registry records — it's the unambiguous anchor.

This means CSV upload format does not include country. Country is metadata about the customer, not about each transaction.

---

## What V1 deliberately does NOT support

- **Multi-currency uploads.** USD only.
- **Customer record upload.** Customers created manually.
- **Payment transactions upload.** Payments are tracked via the AR aging changes over time, not direct upload.
- **Auto-creation on unknown customer.** Reject and require explicit setup.
- **Late fees as part of outstanding.** Out of scope; customer must normalize before upload.
- **Multiple currencies per customer.** Implicit USD per customer V1.

These are all real V2/V3 candidates. None are intended limitations of the design — just deliberate V1 scoping.

---

## Future input flows (V2+)

When added, each new flow extends this document with its own section. Anticipated:

- **Customer onboarding upload** (V2/V3): structured CSV/API to create new customers in bulk with identifiers, country, sector, credit limit, etc.
- **Payment transactions upload** (V2/V3): when customers want to send payment events directly rather than infer from AR snapshots.
- **Credit limit updates** (V2/V3): batch update of credit_limit values.

Each new flow needs the same treatment: required fields, optional fields, validation rules, identifier strategy reference.
