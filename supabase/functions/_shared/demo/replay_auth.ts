/**
 * The demo's own rebuild (Reset Demo, the daily refresh) runs every agent right after deleting
 * the demo's events. The agents' 60-minute rate limit must not stop that run: a second Reset Demo
 * within the hour deleted everything and then every agent answered 429, leaving the public demo
 * empty (review 2026-11-23). The replay sends this header with the service role key; an agent
 * skips its rate limit only in DEMO_MODE and only when the header matches. Outside callers
 * (the anon key, a visitor's browser) are still rate limited.
 */
export const DEMO_REPLAY_HEADER = "x-demo-replay";

export function isDemoReplay(req: Request): boolean {
  if (Deno.env.get("DEMO_MODE") !== "true") return false;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const given = req.headers.get(DEMO_REPLAY_HEADER) ?? "";
  if (!key || given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
