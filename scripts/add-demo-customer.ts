#!/usr/bin/env node
/**
 * scripts/add-demo-customer.ts — add a new demo customer cleanly.
 *
 * Why this exists: every demo customer added before this script was a one-off
 * manual SQL INSERT, and each one drifted from the field contract in a
 * different way (missing customer_identifiers rows, payment_health stuck on
 * 'unknown' because no payment_transactions existed to compute it from, etc.)
 * — exactly the drift B0 had to find and fix after the fact. This script is
 * the single, repeatable path for adding one, so every new customer starts
 * fully populated instead of needing a follow-up cleanup pass.
 *
 * Field contract: docs/DEMO_DATA_CONTRACT.md (table: customers, table:
 * customer_identifiers, table: payment_transactions). docs/INPUT_CONTRACT.md
 * confirms customer-record creation is explicitly manual in V1 — this script
 * is that manual path, made repeatable rather than ad hoc.
 *
 * What it does, in order:
 *   1. Validate all required fields are present and well-formed (throws with
 *      every problem listed at once — never inserts partial data).
 *   2. Generate a persona-aligned payment_transactions history in memory
 *      (8 monthly transactions, mirroring the seed data's cadence) and run
 *      it through the same analyse-payment-behaviour skill ar-aging-agent
 *      uses, so payment_on_time_rate/trend/health are populated on the
 *      customers row itself — not left null pending an AR agent run that,
 *      for a customer with $0 exposure (no invoices seeded — see below),
 *      would never actually happen (AR's payment-behaviour refresh only
 *      touches customers currently breaching utilization).
 *   3. Insert the customers row.
 *   4. Insert customer_identifiers (internal_customer_code always; ticker
 *      and/or cik only if --is-public and given explicitly).
 *   5. Insert the payment_transactions rows generated in step 2.
 *   If step 4 or 5 fails, the customer row from step 3 is deleted before
 *   re-throwing — never leaves a customer without its identifiers/history.
 *
 * Known scope boundary: this script does NOT seed invoices or
 * ar_aging_snapshots (out of the brief — payment_health is the specific gap
 * being closed here, not AR aging). current_exposure is trigger-computed
 * from invoices (see DEMO_DATA_CONTRACT.md), so a customer added by this
 * script will show $0 exposure / 0% utilization until invoices exist for
 * them. That's a legitimate "just onboarded" state, not a bug — but it's
 * worth knowing before you go looking at the AR Aging page for this customer.
 *
 * Usage:
 *   node scripts/add-demo-customer.ts --config path/to/customer.json [--dry-run]
 *   node scripts/add-demo-customer.ts --company-name="Acme Aerospace Inc" \
 *     --sector="Aerospace & Defense" --country-code=US --credit-limit=2000000 \
 *     --scenario=normal_operations --credit-rating-score=72 \
 *     --internal-customer-code=ACME-001 [--dry-run]
 *   node scripts/add-demo-customer.ts --rollback <customer_id>
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as every
 * edge function — RLS locks customers/customer_identifiers/payment_transactions
 * to anon-read-only, so the anon key cannot write here).
 *
 * Config JSON shape (all keys match the --flag names below, camelCase):
 *   {
 *     "companyName": "Acme Aerospace Inc",
 *     "sector": "Aerospace & Defense",
 *     "countryCode": "US",
 *     "creditLimit": 2000000,
 *     "scenario": "normal_operations",
 *     "creditRatingScore": 72,
 *     "internalCustomerCode": "ACME-001",
 *     "isPublic": false,
 *     "ticker": null,
 *     "cik": null,
 *     "paymentPersona": "healthy"
 *   }
 */

import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import {
  analysePaymentBehaviour,
  type PaymentTransaction,
} from "../supabase/functions/_shared/skills/analytical/analyse-payment-behaviour.ts";

// ── Valid enum values (mirrors the CHECK constraints — see DEMO_DATA_CONTRACT.md) ──

const VALID_SECTORS = [
  "Aerospace & Defense",
  "Energy",
  "Industrial Manufacturing",
  "Materials",
  "Transportation",
  "Mining",
  "Other",
] as const;

const VALID_SCENARIOS = [
  "normal_operations",
  "payment_issues",
  "credit_deterioration",
  "negative_news",
  "bankruptcy",
  "growth_opportunity",
  "sec_filing_monitoring",
] as const;

const VALID_PERSONAS = ["healthy", "watch", "at_risk"] as const;
type PaymentPersona = typeof VALID_PERSONAS[number];

// Default payment persona per scenario, when --payment-persona isn't given —
// mirrors the demo distribution described in DEMO_DATA_CONTRACT.md
// ("healthy customers pay 5–8 days early, watch customers pay 2–14 days
// late with some on-time, at_risk customers show worsening lateness").
const SCENARIO_TO_PERSONA: Record<string, PaymentPersona> = {
  normal_operations: "healthy",
  growth_opportunity: "healthy",
  negative_news: "watch",
  sec_filing_monitoring: "watch",
  payment_issues: "at_risk",
  credit_deterioration: "at_risk",
  bankruptcy: "at_risk",
};

// ── Input shape ──────────────────────────────────────────────────────────────

interface CustomerInput {
  companyName?: string;
  sector?: string;
  countryCode?: string;
  creditLimit?: number;
  scenario?: string;
  creditRatingScore?: number;
  internalCustomerCode?: string;
  isPublic?: boolean;
  ticker?: string | null;
  cik?: string | null;
  duns?: string | null;
  industry?: string | null;
  headquarters?: string | null;
  accountManager?: string | null;
  paymentTermsDays?: number;
  creditRatingSource?: string | null;
  notes?: string | null;
  paymentPersona?: PaymentPersona;
}

const REQUIRED_FIELDS: (keyof CustomerInput)[] = [
  "companyName",
  "sector",
  "countryCode",
  "creditLimit",
  "scenario",
  "creditRatingScore",
  "internalCustomerCode",
];

/** Fields required at the DB level (customers table) or displayed prominently
 * in the Customers page / CustomerDetail drawer / CIA context — every one of
 * these gets a real value on the inserted row, never a silent null. Fields
 * NOT in this list (industry, headquarters, notes, ...) are genuinely
 * optional and stay null unless supplied, matching how real seeded customers
 * carry them. */
function validate(input: CustomerInput): asserts input is Required<
  Pick<CustomerInput, "companyName" | "sector" | "countryCode" | "creditLimit" | "scenario" | "creditRatingScore" | "internalCustomerCode">
> & CustomerInput {
  const problems: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      problems.push(`missing required field: ${field}`);
    }
  }

  if (input.sector !== undefined && !VALID_SECTORS.includes(input.sector as typeof VALID_SECTORS[number])) {
    problems.push(`invalid sector "${input.sector}" — must be one of: ${VALID_SECTORS.join(", ")}`);
  }

  if (input.scenario !== undefined && !VALID_SCENARIOS.includes(input.scenario as typeof VALID_SCENARIOS[number])) {
    problems.push(`invalid scenario "${input.scenario}" — must be one of: ${VALID_SCENARIOS.join(", ")}`);
  }

  if (input.countryCode !== undefined && !/^[A-Z]{2}$/.test(input.countryCode)) {
    problems.push(`invalid countryCode "${input.countryCode}" — must be a 2-letter ISO 3166-1 alpha-2 code (e.g. "US")`);
  }

  if (input.creditLimit !== undefined && (!Number.isFinite(input.creditLimit) || input.creditLimit <= 0)) {
    problems.push(`invalid creditLimit "${input.creditLimit}" — must be a positive number`);
  }

  if (
    input.creditRatingScore !== undefined &&
    (!Number.isFinite(input.creditRatingScore) || input.creditRatingScore < 0 || input.creditRatingScore > 100)
  ) {
    problems.push(`invalid creditRatingScore "${input.creditRatingScore}" — must be 0–100`);
  }

  if (input.paymentPersona !== undefined && !VALID_PERSONAS.includes(input.paymentPersona)) {
    problems.push(`invalid paymentPersona "${input.paymentPersona}" — must be one of: ${VALID_PERSONAS.join(", ")}`);
  }

  if (input.isPublic && !input.ticker && !input.cik) {
    problems.push(`isPublic=true requires at least one of ticker or cik`);
  }

  if (problems.length > 0) {
    throw new Error(`add-demo-customer: invalid input —\n  - ${problems.join("\n  - ")}`);
  }
}

// ── Payment history generation ──────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// [start, end] days-early-late per transaction slot (0 = oldest, 7 = most
// recent), matching DEMO_DATA_CONTRACT.md's described demo distribution.
const PERSONA_LATENESS: Record<PaymentPersona, [number, number][]> = {
  healthy: [[-8, -8], [-7, -7], [-8, -6], [-7, -5], [-6, -6], [-7, -5], [-6, -8], [-5, -7]],
  watch: [[2, 4], [-1, 3], [5, 8], [0, 2], [6, 10], [3, 6], [9, 14], [4, 9]],
  at_risk: [[6, 9], [8, 11], [10, 14], [13, 18], [16, 22], [20, 27], [25, 32], [29, 38]],
};

function seededLateness(persona: PaymentPersona, index: number): number {
  const [lo, hi] = PERSONA_LATENESS[persona][index];
  // Deterministic mid-range pick — a real script run doesn't need randomness,
  // and determinism makes --dry-run output reproducible.
  return Math.round((lo + hi) / 2);
}

function generatePaymentHistory(
  persona: PaymentPersona,
  creditLimit: number,
  paymentTermsDays: number,
  now: Date,
): (PaymentTransaction & { payment_date: string; invoice_date: string; invoice_due_date: string; invoice_number: string })[] {
  const count = 8;
  const monthlyAmount = Math.round((creditLimit / 12) / 50) * 50; // round to nearest $50
  const transactions = [];

  for (let i = 0; i < count; i++) {
    // Oldest transaction ~ (count-1) months back, most recent ~5 days ago —
    // spaced so both the last-30-days and prior-30-days windows a payment
    // trend agent would use have real data.
    const monthsBack = count - 1 - i;
    const paymentDate = new Date(now.getTime() - (monthsBack * 30 + 5) * MS_PER_DAY);
    const daysEarlyLate = seededLateness(persona, i);
    const invoiceDueDate = new Date(paymentDate.getTime() - daysEarlyLate * MS_PER_DAY);
    const invoiceDate = new Date(invoiceDueDate.getTime() - paymentTermsDays * MS_PER_DAY);
    const daysToPay = paymentTermsDays + daysEarlyLate;
    const amount = monthlyAmount + (i % 3) * 250; // small realistic variance

    transactions.push({
      payment_date: paymentDate.toISOString().slice(0, 10),
      invoice_date: invoiceDate.toISOString().slice(0, 10),
      invoice_due_date: invoiceDueDate.toISOString().slice(0, 10),
      invoice_number: `SEED-${String(i + 1).padStart(4, "0")}`,
      days_to_pay: daysToPay,
      days_early_late: daysEarlyLate,
      on_time: daysEarlyLate <= 0,
      amount,
    });
  }

  return transactions;
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseCliInput(): { input: CustomerInput; dryRun: boolean; rollbackId: string | null } {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      rollback: { type: "string" },
      "company-name": { type: "string" },
      sector: { type: "string" },
      "country-code": { type: "string" },
      "credit-limit": { type: "string" },
      scenario: { type: "string" },
      "credit-rating-score": { type: "string" },
      "internal-customer-code": { type: "string" },
      "is-public": { type: "boolean" },
      ticker: { type: "string" },
      cik: { type: "string" },
      duns: { type: "string" },
      industry: { type: "string" },
      headquarters: { type: "string" },
      "account-manager": { type: "string" },
      "payment-terms-days": { type: "string" },
      "credit-rating-source": { type: "string" },
      notes: { type: "string" },
      "payment-persona": { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.rollback) {
    return { input: {}, dryRun: false, rollbackId: values.rollback };
  }

  let fromConfig: CustomerInput = {};
  if (values.config) {
    fromConfig = JSON.parse(readFileSync(values.config, "utf8"));
  }

  const fromFlags: CustomerInput = {
    companyName: values["company-name"],
    sector: values.sector,
    countryCode: values["country-code"],
    creditLimit: values["credit-limit"] !== undefined ? Number(values["credit-limit"]) : undefined,
    scenario: values.scenario,
    creditRatingScore: values["credit-rating-score"] !== undefined ? Number(values["credit-rating-score"]) : undefined,
    internalCustomerCode: values["internal-customer-code"],
    isPublic: values["is-public"],
    ticker: values.ticker,
    cik: values.cik,
    duns: values.duns,
    industry: values.industry,
    headquarters: values.headquarters,
    accountManager: values["account-manager"],
    paymentTermsDays: values["payment-terms-days"] !== undefined ? Number(values["payment-terms-days"]) : undefined,
    creditRatingSource: values["credit-rating-source"],
    notes: values.notes,
    paymentPersona: values["payment-persona"] as PaymentPersona | undefined,
  };

  // CLI flags override config file values when both are given.
  const merged: CustomerInput = { ...fromConfig };
  for (const [key, value] of Object.entries(fromFlags)) {
    if (value !== undefined) (merged as any)[key] = value;
  }

  return { input: merged, dryRun: values["dry-run"] ?? false, rollbackId: null };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "add-demo-customer: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
      "The anon key cannot write to customers/customer_identifiers/payment_transactions (RLS locks them to anon-read-only)."
    );
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { input, dryRun, rollbackId } = parseCliInput();

  // --- Rollback path ---
  if (rollbackId) {
    const { data: customer, error: fetchError } = await supabase
      .from("customers").select("id, company_name").eq("id", rollbackId).maybeSingle();
    if (fetchError) throw new Error(`add-demo-customer: rollback lookup failed: ${fetchError.message}`);
    if (!customer) throw new Error(`add-demo-customer: no customer found with id ${rollbackId}`);

    // customer_identifiers and payment_transactions both have
    // ON DELETE CASCADE on customer_id — deleting the customer row is sufficient.
    const { error: deleteError } = await supabase.from("customers").delete().eq("id", rollbackId);
    if (deleteError) throw new Error(`add-demo-customer: rollback delete failed: ${deleteError.message}`);

    console.log(`Rolled back: deleted "${customer.company_name}" (${rollbackId}) and its identifiers/payment history.`);
    return;
  }

  // --- Add-customer path ---
  validate(input);

  const paymentTermsDays = input.paymentTermsDays ?? 45;
  const persona: PaymentPersona = input.paymentPersona ?? SCENARIO_TO_PERSONA[input.scenario!] ?? "watch";
  const now = new Date();

  const transactions = generatePaymentHistory(persona, input.creditLimit!, paymentTermsDays, now);
  const behaviour = analysePaymentBehaviour(transactions);

  const customerRow = {
    company_name: input.companyName,
    sector: input.sector,
    industry: input.industry ?? null,
    country_code: input.countryCode,
    scenario: input.scenario,
    credit_limit: input.creditLimit,
    // current_exposure is trigger-maintained from invoices (see
    // DEMO_DATA_CONTRACT.md) — this script doesn't seed invoices, so it
    // stays at the DB default (0) until invoices exist for this customer.
    credit_rating_score: input.creditRatingScore,
    credit_rating_source: input.creditRatingSource ?? null,
    credit_rating_updated_at: now.toISOString(),
    payment_on_time_rate: behaviour.on_time_rate,
    payment_avg_days_early_late: behaviour.avg_days_early_late,
    payment_trend: behaviour.trend,
    payment_health: behaviour.health,
    payment_behaviour_updated_at: now.toISOString(),
    payment_terms_days: paymentTermsDays,
    headquarters: input.headquarters ?? null,
    account_manager: input.accountManager ?? "Unassigned",
    customer_since: now.toISOString().slice(0, 10),
    company_type: input.isPublic ? "public" : "private",
    notes: input.notes ?? null,
    risk_tags: [],
  };

  const identifierRows = [
    {
      id_type: "internal_customer_code",
      id_value: input.internalCustomerCode,
      is_primary: true,
      source: "manual",
    },
    ...(input.ticker ? [{ id_type: "ticker", id_value: input.ticker, is_primary: true, source: "manual" }] : []),
    ...(input.cik ? [{ id_type: "cik", id_value: input.cik, is_primary: true, source: "manual" }] : []),
    ...(input.duns ? [{ id_type: "duns", id_value: input.duns, is_primary: true, source: "manual" }] : []),
  ];

  if (dryRun) {
    console.log("--- DRY RUN (no writes) ---");
    console.log("customers row:", JSON.stringify(customerRow, null, 2));
    console.log("customer_identifiers rows:", JSON.stringify(identifierRows, null, 2));
    console.log(`payment_transactions: ${transactions.length} rows, persona="${persona}"`);
    console.log(JSON.stringify(transactions, null, 2));
    console.log(`computed payment behaviour: ${JSON.stringify(behaviour, null, 2)}`);
    return;
  }

  const { data: inserted, error: customerError } = await supabase
    .from("customers").insert(customerRow).select("id, company_name").single();
  if (customerError) {
    throw new Error(`add-demo-customer: customers insert failed: ${customerError.message}`);
  }

  const customerId = inserted.id;

  try {
    const { error: identifiersError } = await supabase
      .from("customer_identifiers")
      .insert(identifierRows.map((row) => ({ ...row, customer_id: customerId })));
    if (identifiersError) throw new Error(`customer_identifiers insert failed: ${identifiersError.message}`);

    const { error: paymentsError } = await supabase
      .from("payment_transactions")
      .insert(transactions.map((t) => ({
        customer_id: customerId,
        payment_date: t.payment_date,
        invoice_date: t.invoice_date,
        invoice_due_date: t.invoice_due_date,
        invoice_number: t.invoice_number,
        amount_paid: t.amount,
        days_to_pay: t.days_to_pay,
        days_early_late: t.days_early_late,
        on_time: t.on_time,
        payment_method: "wire_transfer",
        is_partial_payment: false,
        is_demo: true,
      })));
    if (paymentsError) throw new Error(`payment_transactions insert failed: ${paymentsError.message}`);
  } catch (err) {
    // Fails loudly, doesn't leave partial data: delete the customer row we
    // just created (cascades to whichever of identifiers/payments did write)
    // before re-throwing.
    await supabase.from("customers").delete().eq("id", customerId);
    throw new Error(`add-demo-customer: ${(err as Error).message} — rolled back customer ${customerId}.`);
  }

  console.log(`Created "${inserted.company_name}" (${customerId})`);
  console.log(`  identifiers: ${identifierRows.map((r) => r.id_type).join(", ")}`);
  console.log(`  payment_transactions: ${transactions.length} rows, persona="${persona}" → payment_health="${behaviour.health}", trend="${behaviour.trend}"`);
  console.log(`  Note: current_exposure will show $0 until invoices are added for this customer (see script header).`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
