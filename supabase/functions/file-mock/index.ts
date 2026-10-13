/**
 * file-mock — stand-in for the File scoring app's API until the real one exists.
 * Implements the draft contract (claude/CreditPilot_Onboarding_Build_Plan.md §4):
 *
 *   POST {base}/v1/score          → 200 score | 422 insufficient data | 401 bad key
 *   GET  {base}/v1/score/{job_id} → not used by the mock (always answers synchronously)
 *
 * base = https://<project>.supabase.co/functions/v1/file-mock
 * Auth: Authorization: Bearer <FILE_API_KEY> (same secret the onboarding function sends).
 *
 * The score is a transparent toy model for demos and tests, NOT a credit model:
 *   50 + 20 × (current ratio − 1) + 40 × (equity ÷ total assets), clamped to 1–99,
 *   using the latest statement. No statements → 422 (CreditPilot falls back).
 * Special names for testing fallbacks: a legal name containing "TIMEOUT" sleeps 20 s,
 * "FILEDOWN" returns 503.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const key = Deno.env.get("FILE_API_KEY");
  if (!key || req.headers.get("Authorization") !== `Bearer ${key}`) return json({ error: "unauthorized" }, 401);
  const path = new URL(req.url).pathname;
  if (req.method !== "POST" || !path.endsWith("/v1/score")) return json({ error: "not found" }, 404);

  const body = await req.json().catch(() => null) as {
    request_id?: string; company?: { legal_name?: string };
    financials?: { period_end: string; current_assets?: number; current_liabilities?: number; equity?: number; total_assets?: number }[];
  } | null;
  if (!body?.company?.legal_name) return json({ error: "company.legal_name is required" }, 400);
  const name = body.company.legal_name.toUpperCase();
  if (name.includes("FILEDOWN")) return json({ error: "unavailable" }, 503);
  if (name.includes("TIMEOUT")) { await new Promise((r) => setTimeout(r, 20_000)); }

  const s = [...(body.financials ?? [])].sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  if (!s || !s.current_assets || !s.current_liabilities || !s.total_assets || s.equity === undefined) {
    return json({ request_id: body.request_id, error: "insufficient_data" }, 422);
  }
  const currentRatio = s.current_assets / s.current_liabilities;
  const equityRatio = s.equity / s.total_assets;
  const score = Math.max(1, Math.min(99, Math.round(50 + 20 * (currentRatio - 1) + 40 * equityRatio)));
  const band = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "E";
  return json({
    request_id: body.request_id, score, band, model_version: "file-mock-0.1", as_of: new Date().toISOString().slice(0, 10),
    reason_codes: [
      { code: "CURRENT_RATIO", text: `Current ratio ${currentRatio.toFixed(2)}`, direction: currentRatio >= 1.5 ? "positive" : "negative" },
      { code: "EQUITY_RATIO", text: `Equity ${(equityRatio * 100).toFixed(0)}% of assets`, direction: equityRatio >= 0.4 ? "positive" : "negative" },
    ],
    data_used: ["financials"], warnings: ["Mock model for demos and tests. Not a credit score."],
  });
});
