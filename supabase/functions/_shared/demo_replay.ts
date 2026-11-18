/**
 * The demo's agent sequence after a reset, run on the server: the eight monitoring
 * agents together, then the Risk agent (it maps their country / industry / FX events
 * onto customers), then CIA's decisioning (composite events and proposed actions).
 *
 * Used by demo-actions (Reset Demo button, page-load auto-init) and the agent
 * scheduler's daily demo refresh. Server-side because a visitor's browser that closed
 * half-way left the demo reset but without its proposed actions (2026-11-17).
 */
export const DEMO_AGENTS = [
  "ar-aging-agent", "news-monitor-agent", "sec-monitor-agent", "payment-behaviour-agent",
  "industry-risk-agent", "credit-rating-agent", "country-risk-agent", "fx-risk-agent",
];

export async function replayDemoAgents(url: string, anonKey: string, extraHeaders: Record<string, string> = {}, label = "demo replay") {
  const headers = { Authorization: `Bearer ${anonKey}`, apikey: anonKey, "Content-Type": "application/json", ...extraHeaders };
  const call = async (fn: string, body: unknown) => {
    try {
      const r = await fetch(`${url}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
      if (!r.ok && r.status !== 429) console.error(`[${label}] ${fn} answered ${r.status}`);
      await r.body?.cancel();
    } catch (e) {
      console.error(`[${label}] ${fn} failed:`, e instanceof Error ? e.message : String(e));
    }
  };
  await Promise.all(DEMO_AGENTS.map((fn) => call(fn, { triggered_by: "auto" })));
  await call("risk-agent", { triggered_by: "auto" });
  await call("cia-agent", { skip_briefing: true, triggered_by: "auto" });
}

/** Keep the function alive after answering, where the runtime allows it. */
export function inBackground(p: Promise<unknown>): Promise<unknown> | null {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(p); return null; }
  return p;
}
