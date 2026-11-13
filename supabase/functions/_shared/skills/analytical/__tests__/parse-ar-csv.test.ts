import { describe, it, expect } from "vitest";
import { parseARCsv, autoMapColumns, parseDate, parseAmount, detectDateOrder, detectDecimalMark } from "../parse-ar-csv";

// ── autoMapColumns ───────────────────────────────────────────────────────────

describe("autoMapColumns", () => {
  it("maps standard exact-match headers", () => {
    const map = autoMapColumns([
      "invoice_number", "customer_name", "invoice_date", "due_date",
      "amount", "outstanding_amount", "currency", "days_overdue",
    ]);
    expect(map.invoice_number).toBe("invoice_number");
    expect(map.customer_name).toBe("customer_name");
    expect(map.due_date).toBe("due_date");
    expect(map.outstanding_amount).toBe("outstanding_amount");
    expect(map.currency).toBe("currency");
    expect(map.days_overdue).toBe("days_overdue");
  });

  it("maps alias headers: Invoice No, Debtor, Balance", () => {
    const map = autoMapColumns([
      "Invoice No", "Debtor", "Invoice Date", "Due Date", "Amount", "Balance",
    ]);
    expect(map.invoice_number).toBe("Invoice No");
    expect(map.customer_name).toBe("Debtor");
    expect(map.outstanding_amount).toBe("Balance");
  });

  it("missing required column appears in unmapped result", () => {
    // autoMapColumns returns whatever it can; caller checks unmapped
    const map = autoMapColumns(["Invoice No", "Customer", "Due Date"]);
    // outstanding_amount not in headers — should be absent from map
    expect(map.outstanding_amount).toBeUndefined();
  });
});

// ── parseDate ────────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses YYYY-MM-DD", () => {
    expect(parseDate("2025-03-15")).toBe("2025-03-15");
  });

  it("parses YYYY/MM/DD", () => {
    expect(parseDate("2025/03/15")).toBe("2025-03-15");
  });

  it("parses DD/MM/YYYY (day > 12, unambiguous)", () => {
    expect(parseDate("25/03/2025")).toBe("2025-03-25");
  });

  it("parses MM/DD/YYYY (month ≤ 12, day > 12)", () => {
    // 03/25/2025 → month=3, day=25
    expect(parseDate("03/25/2025")).toBe("2025-03-25");
  });

  it("parses ambiguous date DD/MM/YYYY by default", () => {
    // 05/06/2025 is ambiguous → default to DD/MM: day=5 month=6
    expect(parseDate("05/06/2025")).toBe("2025-06-05");
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });
});

// ── parseAmount ──────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  it("parses plain number", () => {
    expect(parseAmount("1234.56")).toBe(1234.56);
  });

  it("parses amount with comma thousands separator", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("1,000,000.00")).toBe(1000000);
  });

  it("strips currency symbols: $, £, €", () => {
    expect(parseAmount("$1,500.00")).toBe(1500);
    expect(parseAmount("£2,000")).toBe(2000);
    expect(parseAmount("€500.50")).toBe(500.5);
  });

  it("returns null for empty string", () => {
    expect(parseAmount("")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseAmount("N/A")).toBeNull();
  });
});

// ── parseARCsv ───────────────────────────────────────────────────────────────

describe("parseARCsv", () => {
  const STANDARD_CSV = [
    "invoice_number,customer_name,invoice_date,due_date,amount,outstanding_amount,currency",
    "INV-001,Acme Corp,2025-01-01,2025-02-01,10000,8500,USD",
    "INV-002,Beta Ltd,2025-01-15,2025-02-15,5000,5000,GBP",
  ].join("\n");

  it("standard headers → auto-mapped correctly, invoices parsed", () => {
    const result = parseARCsv(STANDARD_CSV);
    expect(result.unmapped_columns).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.invoices).toHaveLength(2);
    expect(result.invoices[0].invoice_number).toBe("INV-001");
    expect(result.invoices[0].customer_name).toBe("Acme Corp");
    expect(result.invoices[0].outstanding_amount).toBe(8500);
    expect(result.invoices[0].currency).toBe("USD");
  });

  it("alias headers → auto-mapped (Invoice No, Debtor, Balance)", () => {
    const csv = [
      "Invoice No,Debtor,Invoice Date,Due Date,Amount,Balance",
      "INV-100,Globex Corp,01/01/2025,01/02/2025,20000,20000",
    ].join("\n");
    const result = parseARCsv(csv, undefined, undefined, undefined, "DMY");
    expect(result.unmapped_columns).toHaveLength(0);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].invoice_number).toBe("INV-100");
    expect(result.invoices[0].customer_name).toBe("Globex Corp");
    expect(result.invoices[0].outstanding_amount).toBe(20000);
  });

  it("missing required column appears in unmapped_columns", () => {
    const csv = [
      "invoice_number,customer_name,due_date",
      "INV-001,Acme Corp,2025-02-01",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.unmapped_columns).toContain("outstanding_amount");
  });

  it("days_overdue calculated from due_date when not in CSV", () => {
    // Use a past due date to ensure days_overdue > 0
    const csv = [
      "invoice_number,customer_name,due_date,outstanding_amount",
      "INV-001,Acme Corp,2020-01-01,5000",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.invoices[0].days_overdue).toBeGreaterThan(0);
  });

  it("days_overdue is 0 for future due date", () => {
    const csv = [
      "invoice_number,customer_name,due_date,outstanding_amount",
      "INV-001,Acme Corp,2099-12-31,5000",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.invoices[0].days_overdue).toBe(0);
  });

  it("amount with comma thousands separator parsed as number", () => {
    const csv = [
      "invoice_number,customer_name,due_date,amount,outstanding_amount",
      "INV-001,Acme Corp,2025-02-01,\"1,500,000.00\",\"750,000.00\"",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.invoices[0].amount).toBe(1500000);
    expect(result.invoices[0].outstanding_amount).toBe(750000);
  });

  it("row with empty customer_name is skipped and error recorded", () => {
    const csv = [
      "invoice_number,customer_name,due_date,outstanding_amount",
      "INV-001,,2025-02-01,5000",
      "INV-002,Valid Corp,2025-02-01,1000",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].invoice_number).toBe("INV-002");
  });

  it("semicolon delimiter parsed correctly", () => {
    const csv = [
      "invoice_number;customer_name;due_date;outstanding_amount",
      "INV-001;Acme Corp;2025-02-01;9000",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].outstanding_amount).toBe(9000);
  });

  it("fewer than 2 rows returns error, no invoices", () => {
    const result = parseARCsv("invoice_number,customer_name,due_date,outstanding_amount");
    expect(result.invoices).toHaveLength(0);
    expect(result.errors[0].row).toBe(0);
  });

  it("defaults currency to USD when column absent", () => {
    const csv = [
      "invoice_number,customer_name,due_date,outstanding_amount",
      "INV-001,Acme Corp,2025-02-01,5000",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.invoices[0].currency).toBe("USD");
  });

  // ── invoice_date required when column is mapped ───────────────────────────

  it("invoice_date column present but row value empty → row error, row skipped", () => {
    const csv = [
      "invoice_number,customer_name,invoice_date,due_date,outstanding_amount",
      "INV-001,Acme Corp,,2025-02-01,5000",
    ].join("\n");
    const result = parseARCsv(csv);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/invoice_date/);
    expect(result.invoices).toHaveLength(0);
  });

  // ── as_of_date parameter ─────────────────────────────────────────────────

  it("as_of_date overrides today for days_overdue calculation", () => {
    const csv = [
      "invoice_number,customer_name,invoice_date,due_date,outstanding_amount",
      "INV-001,Acme Corp,2024-11-01,2024-12-01,5000",
    ].join("\n");
    // as_of_date = 2025-01-01, due_date = 2024-12-01 → 31 days overdue
    const result = parseARCsv(csv, undefined, "2025-01-01");
    expect(result.errors).toHaveLength(0);
    expect(result.invoices[0].days_overdue).toBe(31);
  });

  // ── validation_warnings ───────────────────────────────────────────────────

  it("outstanding_amount > amount → validation warning, row still included", () => {
    const csv = [
      "invoice_number,customer_name,invoice_date,due_date,amount,outstanding_amount",
      "INV-001,Acme Corp,2025-01-01,2025-02-01,1000,1500",
    ].join("\n");
    // Pin as_of_date so days_overdue is deterministic and < 365 (no extra warning)
    const result = parseARCsv(csv, undefined, "2025-03-01");
    expect(result.invoices).toHaveLength(1);
    expect(result.validation_warnings).toHaveLength(1);
    expect(result.validation_warnings[0].field).toBe("outstanding_amount");
    expect(result.validation_warnings[0].message).toMatch(/exceeds/);
  });

  // ── currency_warnings ─────────────────────────────────────────────────────

  it("EUR invoice with USD customer_currency → currency warning generated", () => {
    const csv = [
      "invoice_number,customer_name,invoice_date,due_date,outstanding_amount,currency",
      "INV-001,Acme Corp,2025-01-01,2025-02-01,5000,EUR",
    ].join("\n");
    const result = parseARCsv(csv, undefined, undefined, "USD");
    expect(result.invoices).toHaveLength(1);
    expect(result.currency_warnings).toHaveLength(1);
    expect(result.currency_warnings[0].invoice_number).toBe("INV-001");
    expect(result.currency_warnings[0].invoice_currency).toBe("EUR");
    expect(result.currency_warnings[0].expected_currency).toBe("USD");
  });
});


// ── Fixes found while porting Payment Risk (2026-11-13) ─────────────────────

describe("column mapping: most specific name wins", () => {
  it("'Date' before 'Invoice Date' still maps Invoice Date", () => {
    const map = autoMapColumns(["Date", "Invoice No", "Customer", "Invoice Date", "Due Date", "Balance"]);
    expect(map.invoice_date).toBe("Invoice Date");
  });
  it("'Payment Date' is never read as the due date", () => {
    const map = autoMapColumns(["Invoice No", "Customer", "Invoice Date", "Payment Date", "Balance"]);
    expect(map.due_date).toBeUndefined();
  });
  it("bare 'Date' is used when nothing more specific exists", () => {
    expect(autoMapColumns(["Date", "Due Date"]).invoice_date).toBe("Date");
  });
});

describe("dates: one order for the whole file", () => {
  const head = "Invoice No,Customer,Invoice Date,Due Date,Balance";
  it("a US file is read month-first from one unambiguous date", () => {
    const r = parseARCsv([head, "A,X,03/04/2026,04/03/2026,10", "B,X,03/04/2026,03/25/2026,10"].join("\n"));
    expect(r.date_order).toBe("MDY");
    expect(r.invoices[0].invoice_date).toBe("2026-03-04");
    expect(r.invoices[1].due_date).toBe("2026-03-25");
  });
  it("a European file is read day-first", () => {
    const r = parseARCsv([head, "A,X,03/04/2026,25/04/2026,10"].join("\n"));
    expect(r.date_order).toBe("DMY");
    expect(r.invoices[0].invoice_date).toBe("2026-04-03");
  });
  it("an all-ambiguous file imports nothing and asks for the order", () => {
    const r = parseARCsv([head, "A,X,03/04/2026,04/05/2026,10"].join("\n"));
    expect(r.needs_date_order).toBe(true);
    expect(r.invoices).toHaveLength(0);
  });
  it("the caller's order is used when given", () => {
    const r = parseARCsv([head, "A,X,03/04/2026,04/05/2026,10"].join("\n"), undefined, undefined, undefined, "MDY");
    expect(r.invoices[0].invoice_date).toBe("2026-03-04");
    expect(r.needs_date_order).toBeUndefined();
  });
  it("a file mixing both orders asks instead of guessing", () => {
    const r = parseARCsv([head, "A,X,25/04/2026,04/25/2026,10"].join("\n"));
    expect(r.needs_date_order).toBe(true);
    expect(r.invoices).toHaveLength(0);
  });
  it("ISO dates need no order", () => {
    const r = parseARCsv([head, "A,X,2026-03-04,2026-04-03,10"].join("\n"));
    expect(r.needs_date_order).toBeUndefined();
    expect(r.invoices).toHaveLength(1);
  });
  it("detectDateOrder and impossible dates", () => {
    expect(detectDateOrder(["13/01/2026"])).toBe("DMY");
    expect(detectDateOrder(["01/13/2026"])).toBe("MDY");
    expect(detectDateOrder(["01/02/2026"])).toBeNull();
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("29/02/2028")).toBe("2028-02-29");
  });
});

describe("amounts", () => {
  it("European format", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1.234.567,89")).toBe(1234567.89);
    expect(parseAmount("1 234,56", ",")).toBe(1234.56);
  });
  it("negatives", () => {
    expect(parseAmount("(1,234.00)")).toBe(-1234);
    expect(parseAmount("1,234.00-")).toBe(-1234);
    expect(parseAmount("\u22121234.5")).toBe(-1234.5);
    expect(parseAmount("1,234.56 CR")).toBe(-1234.56);
    expect(parseAmount("1,234.56 DR")).toBe(1234.56);
    expect(parseAmount("-$500")).toBe(-500);
  });
  it("currency codes and odd input", () => {
    expect(parseAmount("USD 2,500.00")).toBe(2500);
    expect(parseAmount("1e5")).toBeNull();
    expect(parseAmount("12abc")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
  });
  it("decimal mark decided per column", () => {
    expect(detectDecimalMark(["1.234,56", "500,00", "1.000"])).toBe(",");
    expect(detectDecimalMark(["1,234.56", "500.00", "1,000"])).toBe(".");
    const head = "Invoice No,Customer,Invoice Date,Due Date,Balance";
    const r = parseARCsv([head, 'A,X,2026-01-01,2026-02-01,"1.000"', 'B,X,2026-01-01,2026-02-01,"250,50"'].join("\n"));
    expect(r.invoices.map((i) => i.outstanding_amount)).toEqual([1000, 250.5]);
  });
});
