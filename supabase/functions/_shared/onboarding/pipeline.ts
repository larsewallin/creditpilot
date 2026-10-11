/**
 * New Customer Onboarding pipeline core (pure orchestration, injected providers).
 *
 * Stages: completeness → screening → analysis → decision proposal.
 * Approval, conditions and activation happen after a person acts on the
 * proposal (CIA NEW_CREDIT_LIMIT pending_action), outside this function.
 *
 * NOT IMPLEMENTED YET (Phase 0, step 1): the golden-prospect harness in
 * tests/onboarding is written first and is expected to fail 14/14 until
 * Phase 1 builds each stage.
 */
import type { CreditApplication, OnboardingOutcome, OnboardingProviders, OnboardingSettings } from "./types.ts";
import { ONBOARDING_DEFAULTS } from "./settings.ts";

export interface RunOptions {
  settings?: OnboardingSettings;
  /** ISO date used for entity age, domain age and clocks. Defaults to today. */
  asOf?: string;
}

export async function runOnboarding(
  app: CreditApplication,
  providers: OnboardingProviders,
  opts: RunOptions = {},
): Promise<OnboardingOutcome> {
  const settings = opts.settings ?? ONBOARDING_DEFAULTS;
  void app; void providers; void settings;
  throw new Error("runOnboarding: not implemented yet (Phase 1)");
}
