/**
 * The shared demo personas behind the "Try it as" buttons on the sign-in page.
 * example.com is reserved for examples: these addresses can never belong to a real person.
 * Keep in step with scripts/create-demo-users.mjs.
 */
export const DEMO_PERSONAS = {
  credit_manager: { email: "credit.manager@demo.example.com", display_name: "Demo Credit Manager", role: "credit_manager" },
  credit_analyst: { email: "credit.analyst@demo.example.com", display_name: "Demo Credit Analyst", role: "credit_analyst" },
  sales: { email: "sales.rep@demo.example.com", display_name: "Demo Sales Rep", role: "sales" },
} as const;

export type DemoPersonaKey = keyof typeof DEMO_PERSONAS;

export function personaOf(key: unknown) {
  return typeof key === "string" && Object.hasOwn(DEMO_PERSONAS, key) ? DEMO_PERSONAS[key as DemoPersonaKey] : null;
}
