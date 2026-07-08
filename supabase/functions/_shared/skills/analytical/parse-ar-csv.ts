/**
 * @skill parse-ar-csv
 * @type analytical
 * Parses an AR aging CSV export from any ERP system.
 * Auto-maps common column name aliases to standard fields.
 * Returns parsed invoices ready for database insert.
 * Never throws — returns errors array for invalid rows.
 * @usedBy ar-csv-upload edge function
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawCSVRow {
  [key: string]: string;
}

export interface ParsedInvoice {
  invoice_number:        string;
  customer_name:         string;
  invoice_date:          string;  // ISO date YYYY-MM-DD
  due_date:              string;  // ISO date YYYY-MM-DD
  amount:                number;
  outstanding_amount:    number;
  currency:              string;  // default 'USD'
  days_overdue:          number;  // calculated if not in CSV
  duns?:                 string;
  internal_customer_code?: string;
}

export interface ParseResult {
  invoices:             ParsedInvoice[];
  errors:               { row: number; message: string }[];
  unmapped_columns:     string[];           // required columns that couldn't be auto-mapped
  column_map:           Record<string, string>; // final mapping: { standard_field: csv_header }
  available_columns:    string[];           // all headers found in the CSV
  validation_warnings:  { row: number; field: string; message: string }[];
  currency_warnings:    { row: number; invoice_number: string; invoice_currency: string; expected_currency: string }[];
}

// ─── Column alias map ─────────────────────────────────────────────────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  invoice_number:     ["invoice no", "inv number", "invoice number", "document number", "doc no", "ref", "invoice #", "inv #", "invoice_number"],
  customer_name:      ["customer", "account", "debtor", "client", "company", "customer name", "account name", "customer_name"],
  invoice_date:       ["invoice date", "doc date", "date", "issue date", "inv date", "invoice_date"],
  due_date:           ["due date", "payment due", "maturity date", "due", "payment date", "due_date"],
  amount:             ["amount", "invoice amount", "gross amount", "total", "original amount", "gross"],
  outstanding_amount: ["outstanding", "balance", "open amount", "remaining", "outstanding amount", "open balance", "balance due", "outstanding_amount"],
  currency:               ["currency", "curr", "ccy"],
  days_overdue:           ["days overdue", "dpd", "days past due", "overdue days", "days_overdue"],
  duns:                   ["duns", "duns_number", "d-u-n-s", "dnb_id"],
  internal_customer_code: ["internal_customer_code", "customer_code", "internal_code", "erp_customer_id"],
};

const REQUIRED_FIELDS = ["invoice_number", "customer_name", "invoice_date", "due_date", "outstanding_amount"];

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSVText(text: string): { rows: string[][]; delimiter: string } {
  // Strip BOM if present
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], delimiter: "," };

  // Detect delimiter from first line
  const firstLine = lines[0];
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis  = (firstLine.match(/;/g) ?? []).length;
  const delimiter = semis > commas ? ";" : ",";

  return { rows: lines.map((l) => parseCSVLine(l, delimiter)), delimiter };
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

export function parseDate(val: string): string | null {
  const v = val.trim();
  if (!v) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(v)) {
    return v.replace(/\//g, "-");
  }

  // DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, MM-DD-YYYY
  const sep = v.includes("/") ? "/" : v.includes("-") ? "-" : null;
  if (sep) {
    const parts = v.split(sep).map(Number);
    if (parts.length === 3) {
      const [a, b, c] = parts;
      if (c > 1900) {
        let day: number, month: number;
        if (a > 12) {
          // a must be day → DD/MM/YYYY
          day = a; month = b;
        } else if (b > 12) {
          // b must be day → MM/DD/YYYY
          month = a; day = b;
        } else {
          // Ambiguous — default to DD/MM/YYYY (international ERP convention)
          day = a; month = b;
        }
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return `${c}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
      }
    }
  }

  return null;
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

export function parseAmount(val: string): number | null {
  if (!val || !val.trim()) return null;
  // Remove currency symbols, spaces; remove commas only when used as thousands separators
  const cleaned = val.replace(/[£$€\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ─── Days overdue ─────────────────────────────────────────────────────────────

function calcDaysOverdue(dueDate: string, referenceDate?: Date): number {
  // Use UTC throughout to avoid timezone-dependent day shifts
  const dueMs = Date.UTC(
    parseInt(dueDate.slice(0, 4)),
    parseInt(dueDate.slice(5, 7)) - 1,
    parseInt(dueDate.slice(8, 10))
  );
  const ref = referenceDate ?? new Date();
  const refMs = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  return Math.max(0, Math.floor((refMs - dueMs) / 86_400_000));
}

// ─── Column auto-mapping ──────────────────────────────────────────────────────

export function autoMapColumns(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const usedHeaders = new Set<string>();

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const header of headers) {
      if (usedHeaders.has(header)) continue;
      if (aliases.includes(header.toLowerCase().trim())) {
        result[field] = header;
        usedHeaders.add(header);
        break;
      }
    }
  }

  return result;
}

// ─── Main parse function ──────────────────────────────────────────────────────

export function parseARCsv(
  csvText: string,
  columnMap?: Record<string, string>,
  as_of_date?: string,
  customer_currency?: string
): ParseResult {
  try {
    const { rows } = parseCSVText(csvText);

    if (rows.length < 2) {
      return {
        invoices: [],
        errors: [{ row: 0, message: "CSV has fewer than 2 rows (no data rows found)" }],
        unmapped_columns: REQUIRED_FIELDS.slice(),
        column_map: {},
        available_columns: [],
        validation_warnings: [],
        currency_warnings: [],
      };
    }

    const headers = rows[0];
    const resolvedMap = columnMap ?? autoMapColumns(headers);
    const unmapped_columns = REQUIRED_FIELDS.filter((f) => !resolvedMap[f]);

    const referenceDate = as_of_date ? new Date(as_of_date) : undefined;

    const invoices: ParsedInvoice[] = [];
    const errors: { row: number; message: string }[] = [];
    const validation_warnings: ParseResult["validation_warnings"] = [];
    const currency_warnings: ParseResult["currency_warnings"] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every((cell) => !cell.trim())) continue; // skip blank rows

      const get = (field: string): string => {
        const col = resolvedMap[field];
        if (!col) return "";
        const idx = headers.findIndex((h) => h === col);
        return idx >= 0 ? (row[idx] ?? "").trim() : "";
      };

      const invoiceNumber = get("invoice_number");
      const customerName  = get("customer_name");

      if (!invoiceNumber || !customerName) {
        errors.push({ row: i + 1, message: "Missing invoice_number or customer_name — row skipped" });
        continue;
      }

      const dueDateRaw = get("due_date");
      const dueDate = parseDate(dueDateRaw);
      if (!dueDate) {
        errors.push({ row: i + 1, message: `Invalid due_date: "${dueDateRaw}"` });
        continue;
      }

      // invoice_date required when column is mapped; falls back to due_date when column absent
      let invoiceDate: string;
      if (resolvedMap["invoice_date"]) {
        const invoiceDateRaw = get("invoice_date");
        const parsed = parseDate(invoiceDateRaw);
        if (!parsed) {
          errors.push({ row: i + 1, message: `Invalid or missing invoice_date: "${invoiceDateRaw}"` });
          continue;
        }
        invoiceDate = parsed;
      } else {
        invoiceDate = dueDate;
      }

      const outstandingRaw = get("outstanding_amount");
      const outstanding = parseAmount(outstandingRaw);
      if (outstanding === null) {
        errors.push({ row: i + 1, message: `Invalid outstanding_amount: "${outstandingRaw}"` });
        continue;
      }

      const amountRaw = get("amount");
      const amount = parseAmount(amountRaw) ?? outstanding;

      const daysOverdueRaw = get("days_overdue");
      const parsedDpd = daysOverdueRaw ? parseInt(daysOverdueRaw, 10) : NaN;
      const days_overdue = isNaN(parsedDpd) ? calcDaysOverdue(dueDate, referenceDate) : parsedDpd;

      const currency = get("currency") || "USD";

      // Validation warnings — row is included, not skipped
      if (amount > 0 && outstanding > amount) {
        validation_warnings.push({ row: i + 1, field: "outstanding_amount", message: "Outstanding amount exceeds invoice amount" });
      }
      if (days_overdue > 365) {
        validation_warnings.push({ row: i + 1, field: "days_overdue", message: "Invoice overdue more than 365 days — verify as_of_date" });
      }
      if (amount <= 0) {
        validation_warnings.push({ row: i + 1, field: "amount", message: "Invoice amount is zero or negative" });
      }
      if (outstanding < 0) {
        validation_warnings.push({ row: i + 1, field: "outstanding_amount", message: "Outstanding amount is negative" });
      }

      // Currency mismatch detection
      if (customer_currency && currency && currency !== customer_currency) {
        currency_warnings.push({
          row: i + 1,
          invoice_number: invoiceNumber,
          invoice_currency: currency,
          expected_currency: customer_currency,
        });
      }

      const duns                  = get("duns") || undefined;
      const internal_customer_code = get("internal_customer_code") || undefined;

      invoices.push({
        invoice_number:        invoiceNumber,
        customer_name:         customerName,
        invoice_date:          invoiceDate,
        due_date:              dueDate,
        amount,
        outstanding_amount:    outstanding,
        currency,
        days_overdue:          Math.max(0, days_overdue),
        duns,
        internal_customer_code,
      });
    }

    return { invoices, errors, unmapped_columns, column_map: resolvedMap, available_columns: headers, validation_warnings, currency_warnings };
  } catch (err) {
    return {
      invoices: [],
      errors: [{ row: 0, message: `Parse error: ${(err as Error).message}` }],
      unmapped_columns: [],
      column_map: {},
      available_columns: [],
      validation_warnings: [],
      currency_warnings: [],
    };
  }
}
