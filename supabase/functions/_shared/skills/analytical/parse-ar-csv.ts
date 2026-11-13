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
  /** "DMY" | "MDY" used for slash/dash dates, or null when the file has none */
  date_order?:          DateOrder | null;
  /** true when dates like 03/04/2026 can't be read without the caller choosing the order; nothing is imported */
  needs_date_order?:    boolean;
}

export type DateOrder = "DMY" | "MDY";

// ─── Column alias map ─────────────────────────────────────────────────────────

const COLUMN_ALIASES: Record<string, string[]> = {
  invoice_number:     ["invoice no", "inv number", "invoice number", "document number", "doc no", "ref", "invoice #", "inv #", "invoice_number"],
  customer_name:      ["customer", "account", "debtor", "client", "company", "customer name", "account name", "customer_name"],
  // Most specific first; bare "date" only when nothing more specific is in the file.
  invoice_date:       ["invoice date", "invoice_date", "inv date", "doc date", "issue date", "date"],
  // "payment date" is when an invoice was paid, not when it is due: never mapped here.
  due_date:           ["due date", "due_date", "payment due", "maturity date", "due"],
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

/**
 * Parses one date. Slash/dash dates whose day and month can't be told apart
 * (03/04/2026) are read in `order` (default "DMY"); parseARCsv decides the
 * order for the whole file first and never relies on this default silently.
 */
export function parseDate(val: string, order: DateOrder = "DMY"): string | null {
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
        } else if (order === "MDY") {
          month = a; day = b;
        } else {
          day = a; month = b;
        }
        if (month >= 1 && month <= 12 && day >= 1 && day <= daysIn(c, month)) {
          return `${c}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
      }
    }
  }

  return null;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Decides the day/month order from every slash/dash date in the file:
 * a first part above 12 means day-first, a second part above 12 means
 * month-first. Returns "conflict" when both appear, null when no date settles it.
 */
export function detectDateOrder(values: string[]): DateOrder | "conflict" | null {
  let dmy = false, mdy = false;
  for (const raw of values) {
    const m = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/.exec(raw ?? "");
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  if (dmy && mdy) return "conflict";
  return dmy ? "DMY" : mdy ? "MDY" : null;
}

function isAmbiguousDate(raw: string): boolean {
  const m = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/.exec(raw ?? "");
  return !!m && Number(m[1]) <= 12 && Number(m[2]) <= 12 && m[1] !== m[2];
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

export type DecimalMark = "." | ",";

/**
 * Decides a column's decimal mark from all its values: a value with both marks
 * uses the last one as the decimal mark; a lone comma followed by 1-2 digits
 * at the end ("12,5") means comma. Defaults to "." (US).
 */
export function detectDecimalMark(values: string[]): DecimalMark {
  let comma = 0, dot = 0;
  for (const raw of values) {
    const v = (raw ?? "").replace(/[^\d.,]/g, "");
    const lc = v.lastIndexOf(","), ld = v.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) { if (lc > ld) comma++; else dot++; continue; }
    if (lc >= 0 && /,\d{1,2}$/.test(v) && (v.match(/,/g) ?? []).length === 1) comma++;
    else if (ld >= 0 && /\.\d{1,2}$/.test(v) && (v.match(/\./g) ?? []).length === 1) dot++;
  }
  return comma > dot ? "," : ".";
}

/**
 * Parses an amount: currency symbols and codes, spaces and thousands
 * separators removed; "(1,234.00)", a leading or trailing minus (also the
 * Unicode minus) and a "CR" suffix mean negative. `mark` is the decimal mark;
 * without it a value with both marks uses the last one, otherwise ".".
 */
export function parseAmount(val: string, mark?: DecimalMark): number | null {
  if (!val || !val.trim()) return null;
  let v = val.trim().replace(/\u2212/g, "-");
  let negative = false;
  if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1); }
  if (/\s*CR$/i.test(v)) { negative = true; v = v.replace(/\s*CR$/i, ""); }
  else if (/\s*DR$/i.test(v)) { v = v.replace(/\s*DR$/i, ""); }
  v = v.replace(/[£$€¥]|\b[A-Z]{3}\b/g, "").replace(/[\s\u00a0']/g, "");
  if (/^-/.test(v)) { negative = !negative; v = v.slice(1); }
  if (/-$/.test(v)) { negative = !negative; v = v.slice(0, -1); }
  if (!/^[\d.,]+$/.test(v) || !/\d/.test(v)) return null;
  let m: DecimalMark = mark ?? ".";
  if (!mark) {
    const lc = v.lastIndexOf(","), ld = v.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) m = lc > ld ? "," : ".";
  }
  const thousands = m === "," ? "." : ",";
  const parts = v.split(m);
  if (parts.length > 2) return null;
  const intPart = parts[0].split(thousands).join("");
  if (!/^\d*$/.test(intPart) || (parts[1] !== undefined && !/^\d*$/.test(parts[1]))) return null;
  const num = Number(parts[1] !== undefined ? `${intPart || "0"}.${parts[1]}` : intPart);
  if (!Number.isFinite(num)) return null;
  return negative ? -num : num;
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

  // For each field the most specific alias wins, whatever the column order.
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const header = headers.find((h) => !usedHeaders.has(h) && h.toLowerCase().trim() === alias);
      if (header !== undefined) {
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
  customer_currency?: string,
  date_order?: DateOrder
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

    const columnValues = (field: string): string[] => {
      const idx = resolvedMap[field] ? headers.findIndex((h) => h === resolvedMap[field]) : -1;
      return idx >= 0 ? rows.slice(1).map((r) => r[idx] ?? "") : [];
    };

    // Day/month order for the whole file: given by the caller, else read from
    // the dates themselves. Never guessed: an ambiguous file imports nothing.
    const dateValues = [...columnValues("invoice_date"), ...columnValues("due_date")];
    let order: DateOrder | null = date_order ?? null;
    if (!order) {
      const found = detectDateOrder(dateValues);
      if (found === "conflict") {
        return {
          invoices: [], unmapped_columns, column_map: resolvedMap, available_columns: headers,
          errors: [{ row: 0, message: "The file mixes day-first and month-first dates; fix the dates or choose the order." }],
          validation_warnings: [], currency_warnings: [], date_order: null, needs_date_order: true,
        };
      }
      order = found;
      if (!order && dateValues.some(isAmbiguousDate)) {
        return {
          invoices: [], unmapped_columns, column_map: resolvedMap, available_columns: headers,
          errors: [{ row: 0, message: "Dates like 03/04/2026 can be read two ways. Choose whether the file uses day/month or month/day." }],
          validation_warnings: [], currency_warnings: [], date_order: null, needs_date_order: true,
        };
      }
    }
    const readDate = (v: string) => parseDate(v, order ?? "DMY");

    const outstandingMark = detectDecimalMark(columnValues("outstanding_amount"));
    const amountMark = detectDecimalMark(columnValues("amount"));

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
      const dueDate = readDate(dueDateRaw);
      if (!dueDate) {
        errors.push({ row: i + 1, message: `Invalid due_date: "${dueDateRaw}"` });
        continue;
      }

      // invoice_date required when column is mapped; falls back to due_date when column absent
      let invoiceDate: string;
      if (resolvedMap["invoice_date"]) {
        const invoiceDateRaw = get("invoice_date");
        const parsed = readDate(invoiceDateRaw);
        if (!parsed) {
          errors.push({ row: i + 1, message: `Invalid or missing invoice_date: "${invoiceDateRaw}"` });
          continue;
        }
        invoiceDate = parsed;
      } else {
        invoiceDate = dueDate;
      }

      const outstandingRaw = get("outstanding_amount");
      const outstanding = parseAmount(outstandingRaw, outstandingMark);
      if (outstanding === null) {
        errors.push({ row: i + 1, message: `Invalid outstanding_amount: "${outstandingRaw}"` });
        continue;
      }

      const amountRaw = get("amount");
      const amount = parseAmount(amountRaw, amountMark) ?? outstanding;

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

    return { invoices, errors, unmapped_columns, column_map: resolvedMap, available_columns: headers, validation_warnings, currency_warnings, date_order: order };
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
