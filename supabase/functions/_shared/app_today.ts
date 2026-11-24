/**
 * The date to age invoices and payments against, as private.app_today() in the database:
 * on the public demo, the day the demo was built (instance_settings.demo_as_of); elsewhere,
 * today's UTC date. Server code that ages invoices for an answer uses this, so the assistant
 * agrees with AR Aging and the alerts at any hour (review 2026-11-23). "YYYY-MM-DD".
 */
// deno-lint-ignore no-explicit-any
export async function appToday(db: any): Promise<string> {
  const utc = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await db.from("instance_settings").select("public_demo, demo_as_of").eq("id", true).maybeSingle();
    return data?.public_demo && data?.demo_as_of ? String(data.demo_as_of).slice(0, 10) : utc;
  } catch {
    return utc;
  }
}
