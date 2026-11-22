#!/usr/bin/env node
/**
 * Page check: opens every page of a built CreditPilot as the demo credit manager and fails on
 * what a user should never see. Run on every PR by CI (`.github/workflows/ci.yml`, "Page check").
 *
 *   node scripts/page-check.mjs [base-url]      (default http://localhost:4173, `vite preview`)
 *
 * Reads the live demo data (the public demo, read only). It never costs money and never changes
 * data: the browser blocks the assistant (cia-agent) and the demo reset (demo-actions), which
 * would otherwise run every agent and a paid briefing when a page loads.
 *
 * Fails a page on: a console error, an uncaught exception, a failed request to the app's own
 * server functions (other than the blocked ones), the words undefined / NaN / [object Object],
 * a raw code (snake_case such as days_beyond_terms), an old score band letter ("band B"),
 * or an empty page.
 */
import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "http://localhost:4173").replace(/\/$/, "");
const PAGES = [
  "/cia", "/events", "/actions", "/news", "/aging", "/sec", "/payments", "/industry",
  "/country", "/fx", "/customers", "/new-customers", "/settings", "/about",
];
// Settings has four tabs; each one is checked.
const SETTINGS_TABS = ["Credit policy", "Users and authorities", "Score source and schedules", "Connectors"];
const BLOCKED = /\/functions\/v1\/(cia-agent|demo-actions)\b/;
// Words that are fine although they look like codes (none yet). Add with a reason.
const ALLOWED_CODES = new Set([]);

const browser = await chromium.launch({
  ...(process.env.PAGE_CHECK_CHROME ? { executablePath: process.env.PAGE_CHECK_CHROME } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let problems = [];
const blocked = [];
page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED_BY_CLIENT/i.test(m.text())) problems.push(`console error: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => problems.push(`exception: ${String(e.message).slice(0, 200)}`));
page.on("response", (r) => { if (/\/functions\/v1\//.test(r.url()) && r.status() >= 400) problems.push(`HTTP ${r.status()} from ${new URL(r.url()).pathname}`); });
await context.route(BLOCKED, (route) => { blocked.push(new URL(route.request().url()).pathname); return route.abort("blockedbyclient"); });

function textProblems(text) {
  const out = [];
  for (const w of ["undefined", "NaN", "[object Object]"]) if (new RegExp(`\\b${w.replace(/[[\]]/g, "\\$&")}\\b`).test(text)) out.push(`shows "${w}"`);
  // File paths shown to developers on purpose ("For developers: _shared/x/y_z.ts") are not codes.
  const words = text.replace(/\S+\.(?:ts|tsx|js|mjs|sql|md)\b/g, " ");
  const codes = [...new Set(words.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [])].filter((c) => !ALLOWED_CODES.has(c));
  for (const c of codes.slice(0, 8)) {
    const i = text.indexOf(c);
    out.push(`shows code ${c}: "…${text.slice(Math.max(0, i - 60), i + c.length + 40).replace(/\s+/g, " ")}…"`);
  }
  const band = text.match(/\bband [A-E]\b/i);
  if (band) out.push(`shows "${band[0]}"`);
  if (text.replace(/\s+/g, " ").trim().length < 40) out.push("page is empty");
  return out;
}

async function settle() {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // Spinners and "Loading…" text gone, or 15 seconds.
  await page.waitForFunction(() => !/Loading…|Loading\.\.\./.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 15_000 }).catch(() => {});
}

const results = [];
async function check(label) {
  await settle();
  const text = await page.locator("main").innerText().catch(() => "");
  const all = [...problems, ...textProblems(text)];
  results.push({ label, all });
  console.log(`${all.length ? "FAIL" : "ok  "}  ${label}${all.length ? "\n        " + all.join("\n        ") : ""}`);
  problems = [];
}

// Sign in as the demo credit manager.
await page.goto(`${BASE}/login`);
await page.getByRole("button", { name: /Try it as credit manager/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
problems = [];

for (const path of PAGES) {
  await page.goto(`${BASE}${path}`);
  if (path === "/settings") {
    for (const tab of SETTINGS_TABS) {
      await settle();
      await page.getByRole("tab", { name: tab }).click();
      await check(`/settings › ${tab}`);
    }
  } else {
    await check(path);
  }
}

await browser.close();
const failed = results.filter((r) => r.all.length);
console.log(`\n${results.length - failed.length}/${results.length} pages ok. Blocked (no cost, no change): ${[...new Set(blocked)].join(", ") || "none"}.`);
process.exit(failed.length ? 1 : 0);
