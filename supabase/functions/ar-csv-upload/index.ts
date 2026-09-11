/**
 * ar-csv-upload — supabase/functions/ar-csv-upload/index.ts
 *
 * Accepts a multipart/form-data POST with a CSV file and an optional
 * column_map JSON blob. Parses the CSV using the parse-ar-csv skill,
 * resolves customers via identifier lookup (duns → internal_customer_code,
 * in that precedence order), then replaces open/overdue invoices for each
 * matched customer with the uploaded data.
 *
 * Request body: multipart/form-data
 *   file              — CSV file (required)
 *   column_map        — JSON string: { standard_field: csv_header } (optional)
 *   is_demo           — "true" | "false" (optional, defaults to false)
 *   as_of_date        — ISO date string for days_overdue calculation (optional, defaults to today)
 *   customer_currency — expected currency code e.g. "USD" (optional, triggers currency mismatch warnings)
 *
 * Response:
 *   { inserted: number, skipped_rows: number, errors: [...],
 *     unmatched_customers: { customer_name: string, reason: string }[],
 *     validation_warnings: [...], currency_warnings: [...] }
 *
 * Tables read:   customer_identifiers
 * Tables written: invoices
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import { parseARCsv } from "../_shared/skills/analytical/parse-ar-csv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const columnMapRaw = formData.get("column_map") as string | null;
    const columnMap = columnMapRaw ? JSON.parse(columnMapRaw) : undefined;

    const isDemo = formData.get("is_demo") === "true";
    const as_of_date = (formData.get("as_of_date") as string | null) ?? undefined;
    const customer_currency = (formData.get("customer_currency") as string | null) ?? undefined;

    const csvText = await file.text();
    const parseResult = parseARCsv(csvText, columnMap, as_of_date, customer_currency);

    if (parseResult.unmapped_columns.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Required columns could not be mapped",
          unmapped_columns: parseResult.unmapped_columns,
          available_columns: parseResult.available_columns,
          column_map: parseResult.column_map,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Resolve customer IDs ────────────────────────────────────────────────

    // Collect unique identifier values present across all invoices
    const uniqueDuns = [...new Set(
      parseResult.invoices.map((inv) => inv.duns).filter((v): v is string => !!v)
    )];
    const uniqueCodes = [...new Set(
      parseResult.invoices.map((inv) => inv.internal_customer_code).filter((v): v is string => !!v)
    )];

    // Batch fetch customer_identifiers — one query per identifier type
    const dunsToCustId  = new Map<string, string>(); // duns value → customer_id
    const codeToCustId  = new Map<string, string>(); // internal_customer_code value → customer_id

    if (uniqueDuns.length > 0) {
      const { data: dunsRows, error: dunsErr } = await supabase
        .from("customer_identifiers")
        .select("customer_id, id_value")
        .eq("id_type", "duns")
        .in("id_value", uniqueDuns);
      if (dunsErr) console.error("customer_identifiers duns lookup failed:", dunsErr.message);
      for (const row of dunsRows ?? []) {
        dunsToCustId.set(row.id_value, row.customer_id);
      }
    }

    if (uniqueCodes.length > 0) {
      const { data: codeRows, error: codeErr } = await supabase
        .from("customer_identifiers")
        .select("customer_id, id_value")
        .eq("id_type", "internal_customer_code")
        .in("id_value", uniqueCodes);
      if (codeErr) console.error("customer_identifiers internal_customer_code lookup failed:", codeErr.message);
      for (const row of codeRows ?? []) {
        codeToCustId.set(row.id_value, row.customer_id);
      }
    }

    // Resolve each invoice to a customer_id using identifier precedence:
    //   duns → internal_customer_code → unmatched
    const unmatchedCustomers: { customer_name: string; reason: string }[] = [];
    const seenUnmatched = new Set<string>();

    const resolvedIds: (string | null)[] = parseResult.invoices.map((inv) => {
      // Try duns first
      if (inv.duns) {
        const id = dunsToCustId.get(inv.duns);
        if (id) return id;
        // duns present but not found — fall through to internal_customer_code
        if (inv.internal_customer_code) {
          const id2 = codeToCustId.get(inv.internal_customer_code);
          if (id2) return id2;
          const reason = `duns not found: ${inv.duns}, internal_customer_code not found: ${inv.internal_customer_code}`;
          const key = `${inv.customer_name}::${reason}`;
          if (!seenUnmatched.has(key)) { seenUnmatched.add(key); unmatchedCustomers.push({ customer_name: inv.customer_name, reason }); }
          return null;
        }
        const reason = `duns not found: ${inv.duns}, no internal_customer_code provided`;
        const key = `${inv.customer_name}::${reason}`;
        if (!seenUnmatched.has(key)) { seenUnmatched.add(key); unmatchedCustomers.push({ customer_name: inv.customer_name, reason }); }
        return null;
      }
      // No duns — try internal_customer_code alone
      if (inv.internal_customer_code) {
        const id = codeToCustId.get(inv.internal_customer_code);
        if (id) return id;
        const reason = `internal_customer_code not found: ${inv.internal_customer_code}`;
        const key = `${inv.customer_name}::${reason}`;
        if (!seenUnmatched.has(key)) { seenUnmatched.add(key); unmatchedCustomers.push({ customer_name: inv.customer_name, reason }); }
        return null;
      }
      // No identifiers at all
      const key = `${inv.customer_name}::no identifier provided`;
      if (!seenUnmatched.has(key)) { seenUnmatched.add(key); unmatchedCustomers.push({ customer_name: inv.customer_name, reason: "no identifier provided" }); }
      return null;
    });

    // ── Build insert rows ───────────────────────────────────────────────────

    const uploadedAt = new Date().toISOString();
    const toInsert: Record<string, unknown>[] = [];

    for (let i = 0; i < parseResult.invoices.length; i++) {
      const inv = parseResult.invoices[i];
      const customerId = resolvedIds[i];
      if (!customerId) continue; // unmatched — already tracked above

      toInsert.push({
        customer_id:        customerId,
        invoice_number:     inv.invoice_number,
        invoice_date:       inv.invoice_date,
        due_date:           inv.due_date,
        invoice_amount:     inv.amount,
        amount_paid:        inv.amount - inv.outstanding_amount,
        outstanding_amount: inv.outstanding_amount,
        currency:           inv.currency ?? "USD",
        days_overdue:       inv.days_overdue,
        status:             inv.days_overdue > 0 ? "overdue" : "open",
        uploaded_at:        uploadedAt,
        upload_source:      "csv",
        is_demo:            isDemo,
      });
    }

    // ── Replace open/overdue invoices per matched customer ─────────────────

    const matchedCustomerIds = [...new Set(toInsert.map((r) => r.customer_id as string))];

    if (matchedCustomerIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("invoices")
        .delete()
        .in("customer_id", matchedCustomerIds)
        .in("status", ["open", "overdue"])
        .eq("is_demo", isDemo);

      if (deleteError) {
        return new Response(
          JSON.stringify({ error: "Failed to clear existing invoices", detail: deleteError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Insert new invoices ─────────────────────────────────────────────────

    let inserted = 0;
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("invoices").insert(toInsert);
      if (insertError) {
        return new Response(
          JSON.stringify({ error: "Failed to insert invoices", detail: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      inserted = toInsert.length;

      for (const customerId of matchedCustomerIds) {
        const { error: refreshError } = await supabase.rpc("fn_refresh_ar_aging", {
          p_customer_id: customerId,
          p_as_of: as_of_date ?? new Date().toISOString().split("T")[0],
        });
        if (refreshError) {
          console.error(`Snapshot refresh failed for customer ${customerId}:`, refreshError.message);
        }
      }
    }

    return new Response(
      JSON.stringify({
        inserted,
        skipped_rows:         parseResult.errors.length,
        errors:               parseResult.errors,
        unmatched_customers:  unmatchedCustomers,
        column_map:           parseResult.column_map,
        validation_warnings:  parseResult.validation_warnings,
        currency_warnings:    parseResult.currency_warnings,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
