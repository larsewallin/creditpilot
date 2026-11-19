/**
 * The public demo focuses on the CIA (founder, 2026-11-18): New customers stays in the sidebar,
 * and opening it shows this note instead of the onboarding flow. Onboarding is in the open-source
 * code and works on a company's own CreditPilot.
 */
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";

export function OnboardingDemoNotice() {
  return (
    <div className="max-w-xl mx-auto mt-16 bg-card border rounded-xl p-6 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-primary" />
        <h1 className="text-base font-semibold">Onboarding isn't available in the demo</h1>
      </div>
      <p className="text-muted-foreground">
        New customers takes a credit application from the first form to an approved limit: official register checks,
        sanctions screening, the credit provider's report and a proposed limit for a credit manager to approve.
      </p>
      <p className="text-muted-foreground">
        It's part of the open-source code and works on your own CreditPilot.{" "}
        <a className="text-primary underline" href="https://github.com/larsewallin/creditpilot/blob/main/docs/RUN_IT_YOURSELF.md" target="_blank" rel="noreferrer">Run it yourself</a>.
      </p>
      <p>
        In the demo, try the CIA instead: <Link className="text-primary underline" to="/cia?q=Which%20customers%20should%20I%20worry%20about%20this%20week%3F">ask which customers to worry about this week</Link>.
      </p>
    </div>
  );
}
