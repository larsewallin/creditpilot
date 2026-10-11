#!/usr/bin/env node
// Creates (or refreshes) the CreditPilot demo users. There is no sign-up in
// CreditPilot: every account is created by an admin, with this script or in
// the Supabase dashboard.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-demo-users.mjs
//
// Prints each user's email and a newly generated password ONCE. Re-running
// resets the passwords and keeps roles in sync. Run it for staging and prod
// separately (different URL and key each time).

import { randomBytes } from "crypto";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Project Settings → API keys).");
  process.exit(1);
}

// example.com is reserved for examples: these addresses can never belong to a real person.
const DEMO_USERS = [
  { email: "credit.manager@demo.example.com", display_name: "Demo Credit Manager", role: "credit_manager" },
  { email: "credit.analyst@demo.example.com", display_name: "Demo Credit Analyst", role: "credit_analyst" },
  { email: "sales.rep@demo.example.com", display_name: "Demo Sales Rep", role: "sales" },
];

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function call(method, path, body) {
  const res = await fetch(`${URL}${path}`, { method, headers: { ...headers, ...(path.startsWith("/rest/") ? { Prefer: "resolution=merge-duplicates,return=minimal" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function findUserId(email) {
  for (let page = 1; page <= 20; page++) {
    const r = await call("GET", `/auth/v1/admin/users?page=${page}&per_page=200`);
    const hit = (r.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if ((r.users ?? []).length < 200) return null;
  }
  return null;
}

console.log(`Target: ${URL}\n`);
for (const u of DEMO_USERS) {
  const password = randomBytes(12).toString("base64url");
  let id = await findUserId(u.email);
  if (id) {
    await call("PUT", `/auth/v1/admin/users/${id}`, { password, email_confirm: true });
  } else {
    const created = await call("POST", "/auth/v1/admin/users", { email: u.email, password, email_confirm: true });
    id = created.id;
  }
  await call("POST", "/rest/v1/app_users?on_conflict=user_id", [{ user_id: id, email: u.email, display_name: u.display_name, role: u.role, is_demo: true, active: true }]);
  console.log(`${u.role.padEnd(15)} ${u.email}   password: ${password}`);
}
console.log("\nStore these passwords somewhere safe now; they are not shown again.");
