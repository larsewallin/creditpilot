/**
 * @skill fetch-credit-score
 * @type integration
 * @description Provider-agnostic credit score fetcher.
 *   Returns [] silently if no API key provided or any fetch fails.
 *   Adding a new provider: implement CreditScoreProvider interface only.
 *   All providers run in parallel via Promise.allSettled — one failure
 *   does not block the others.
 * @input { company_name, identifier?, providers: CreditScoreProvider[] }
 * @output CreditSignal[] — one entry per provider that returned a result
 * @usedBy ar-aging-agent, cia-agent
 */

import { CreditSignal } from "../analytical/normalise-credit-signal.ts";

// ─── Provider interface ───────────────────────────────────────────────────────

export interface CreditScoreProvider {
  name: string;
  /**
   * Fetch a credit score for the given company.
   * @param companyName  — display name for search / matching
   * @param identifier   — CIK (SEC), DUNS (D&B), ticker, or other provider-specific ID
   * Returns null if the provider cannot find the company or has no data.
   */
  fetchScore(
    companyName: string,
    identifier?: string
  ): Promise<CreditSignal | null>;
}

// ─── D&B stub ─────────────────────────────────────────────────────────────────

/** D&B Paydex / Failure Score — ready to wire when D&B API access is available. */
export class DnBProvider implements CreditScoreProvider {
  readonly name = "dnb_paydex";

  constructor(private readonly apiKey: string) {}

  async fetchScore(
    _companyName: string,
    _duns?: string
  ): Promise<CreditSignal | null> {
    if (!this.apiKey) return null;
    // Wire up: POST https://plus.dnb.com/v1/data/duns/{duns}
    // Response: data.organization.paydexScore.score (1–100)
    return null;
  }
}

// ─── Coface stub ──────────────────────────────────────────────────────────────

/** Coface — ready to wire when Coface API access is available. */
export class CofaceProvider implements CreditScoreProvider {
  readonly name = "coface";

  constructor(private readonly apiKey: string) {}

  async fetchScore(
    _companyName: string,
    _identifier?: string
  ): Promise<CreditSignal | null> {
    if (!this.apiKey) return null;
    // Wire up Coface API — score range 0–10 where 10 = best
    return null;
  }
}

// ─── Atradius stub ────────────────────────────────────────────────────────────

/** Atradius — ready to wire when Atradius API access is available. */
export class AtradiusProvider implements CreditScoreProvider {
  readonly name = "atradius";

  constructor(private readonly apiKey: string) {}

  async fetchScore(
    _companyName: string,
    _identifier?: string
  ): Promise<CreditSignal | null> {
    if (!this.apiKey) return null;
    // Wire up: Atradius Atrium API
    // https://developer.atradius.com/
    // Response: buyer credit limit recommendation and risk category (1-10 scale)
    // Map to CreditSignal: source='atradius', raw_value=riskCategory (1-10)
    return null;
  }
}

// ─── Euler Hermes stub ────────────────────────────────────────────────────────

/** Euler Hermes (Allianz Trade) — ready to wire when API access is available. */
export class EulerHermesProvider implements CreditScoreProvider {
  readonly name = "euler_hermes";

  constructor(private readonly apiKey: string) {}

  async fetchScore(
    _companyName: string,
    _identifier?: string
  ): Promise<CreditSignal | null> {
    if (!this.apiKey) return null;
    // Wire up: Euler Hermes Grade API
    // https://developer.eulerhermes.com/
    // Response: grade on 1-6 scale (1=best, reversed)
    // Map to CreditSignal: source='euler_hermes', raw_value=grade (1-6)
    // Note: normalise-credit-signal handles the 1-10 reversed scale correctly
    return null;
  }
}

// ─── Main fetch function ──────────────────────────────────────────────────────

/**
 * Runs all providers in parallel. Returns only non-null results.
 * Never throws — any individual provider failure is swallowed.
 * Available providers: DnBProvider, CofaceProvider, AtradiusProvider, EulerHermesProvider
 * All return null until API keys are configured — safe to include unused providers
 */
export async function fetchCreditScores(input: {
  company_name: string;
  identifier?: string;
  providers: CreditScoreProvider[];
}): Promise<CreditSignal[]> {
  if (!input.providers || input.providers.length === 0) return [];

  const settled = await Promise.allSettled(
    input.providers.map((p) =>
      p.fetchScore(input.company_name, input.identifier)
    )
  );

  return settled
    .filter(
      (r): r is PromiseFulfilledResult<CreditSignal> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);
}
