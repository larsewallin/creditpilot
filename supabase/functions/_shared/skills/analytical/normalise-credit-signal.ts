/**
 * @skill normalise-credit-signal
 * @type analytical
 * @description Converts any credit score from any supported provider to a common 0–100 scale
 *   where HIGHER = LOWER RISK (safer). Supports payment behaviour scores, financial health
 *   scores, rating agency letter grades, trade credit insurer grades, and internal scores.
 *   Never throws — returns normalised_score: 50 with confidence: 'low' for unrecognised inputs.
 * @input CreditSignal — source identifier, raw value (numeric or letter rating), date, confidence
 * @output NormalisedSignal — 0–100 score, interpretation band, original signal fields
 * @usedBy credit-limit-review-agent (planned), onboarding-agent (planned)
 */

export type SignalSource =
  | "dnb_paydex"
  | "dnb_failure_score"
  | "experian_intelliscore"
  | "equifax_business"
  | "moodys"
  | "sp_fitch"
  | "coface"
  | "atradius"
  | "euler_hermes"
  | "internal_payment_score"
  | "manual"
  | "estimated";

export interface CreditSignal {
  source: SignalSource;
  raw_value: number | string; // string for letter ratings like "BBB+"
  as_of_date: string;         // ISO date
  confidence: "high" | "medium" | "low";
}

export interface NormalisedSignal {
  source: SignalSource;
  raw_value: number | string;
  normalised_score: number;   // 0–100, higher = lower risk
  as_of_date: string;
  confidence: "high" | "medium" | "low";
  interpretation: "very_safe" | "safe" | "watch" | "concern" | "high_risk";
}

// ---------------------------------------------------------------------------
// Rating maps
// ---------------------------------------------------------------------------

const MOODYS_MAP: Record<string, number> = {
  AAA: 100, AA1: 97, AA2: 94, AA3: 91,
  A1: 88, A2: 85, A3: 82,
  BAA1: 75, BAA2: 70, BAA3: 65,
  BA1: 55, BA2: 48, BA3: 41,
  B1: 33, B2: 26, B3: 19,
  CAA1: 12, CAA2: 8, CAA3: 4,
  CA: 2, C: 0,
};

const SP_FITCH_MAP: Record<string, number> = {
  "AAA": 100, "AA+": 97, "AA": 94, "AA-": 91,
  "A+": 88, "A": 85, "A-": 82,
  "BBB+": 75, "BBB": 70, "BBB-": 65,
  "BB+": 55, "BB": 48, "BB-": 41,
  "B+": 33, "B": 26, "B-": 19,
  "CCC+": 12, "CCC": 8, "CCC-": 4,
  "CC": 2, "C": 0, "D": 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toInterpretation(
  score: number
): NormalisedSignal["interpretation"] {
  if (score >= 80) return "very_safe";
  if (score >= 60) return "safe";
  if (score >= 40) return "watch";
  if (score >= 20) return "concern";
  return "high_risk";
}

/** Normalise a Moody's rating string. Returns null if unrecognised. */
function normaliseMoodys(raw: string): number | null {
  // Canonicalise: uppercase, strip spaces, convert Moody's notation
  // e.g. "Aa2" → "AA2", "Baa1" → "BAA1", "Caa3" → "CAA3"
  const key = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (key in MOODYS_MAP) return MOODYS_MAP[key];
  return null;
}

/** Normalise an S&P / Fitch rating string. Returns null if unrecognised. */
function normaliseSpFitch(raw: string): number | null {
  // Canonicalise: uppercase, strip spaces, e.g. "bbb+" → "BBB+", "BBB +" → "BBB+"
  const key = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (key in SP_FITCH_MAP) return SP_FITCH_MAP[key];
  return null;
}

const FALLBACK: Pick<NormalisedSignal, "normalised_score" | "confidence" | "interpretation"> = {
  normalised_score: 50,
  confidence: "low",
  interpretation: "watch",
};

// ---------------------------------------------------------------------------
// Core normalisation logic per source
// ---------------------------------------------------------------------------

function normaliseValue(
  source: SignalSource,
  raw: number | string
): { score: number; valid: boolean } {
  const num = typeof raw === "number" ? raw : parseFloat(raw as string);

  switch (source) {
    // Pass-through (already 0–100, higher = safer)
    case "dnb_paydex":
    case "experian_intelliscore":
    case "internal_payment_score":
    case "manual":
    case "estimated":
      if (isNaN(num)) return { score: 50, valid: false };
      return { score: clamp(num), valid: true };

    // Equifax Business: 101–992, higher = safer → map to 0–100
    case "equifax_business":
      if (isNaN(num)) return { score: 50, valid: false };
      return { score: clamp((num - 101) / (992 - 101) * 100), valid: true };

    // D&B Failure Score: 1–100, higher = HIGHER risk → invert
    case "dnb_failure_score":
      if (isNaN(num)) return { score: 50, valid: false };
      return { score: clamp(100 - num), valid: true };

    // Moody's letter ratings
    case "moodys": {
      const result = normaliseMoodys(String(raw));
      if (result === null) return { score: 50, valid: false };
      return { score: result, valid: true };
    }

    // S&P / Fitch letter ratings
    case "sp_fitch": {
      const result = normaliseSpFitch(String(raw));
      if (result === null) return { score: 50, valid: false };
      return { score: result, valid: true };
    }

    // Coface: 0–10 where 10 = best → multiply by 10
    case "coface":
      if (isNaN(num)) return { score: 50, valid: false };
      return { score: clamp(num * 10), valid: true };

    // Atradius: 1–10 where 10 = best → (value - 1) / 9 * 100
    case "atradius":
      if (isNaN(num)) return { score: 50, valid: false };
      return { score: clamp((num - 1) / 9 * 100), valid: true };

    // Euler Hermes: 1–10 scale, 1 = best (reversed) → (10 - value) / 9 * 100
    case "euler_hermes":
      if (isNaN(num)) return { score: 50, valid: false };
      return { score: clamp((10 - num) / 9 * 100), valid: true };

    default:
      return { score: 50, valid: false };
  }
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export function normaliseCreditSignal(signal: CreditSignal): NormalisedSignal {
  const { score, valid } = normaliseValue(signal.source, signal.raw_value);
  const normalised_score = round1(score);

  return {
    source: signal.source,
    raw_value: signal.raw_value,
    normalised_score,
    as_of_date: signal.as_of_date,
    confidence: valid ? signal.confidence : "low",
    interpretation: toInterpretation(normalised_score),
  };
}

export function normaliseAll(signals: CreditSignal[]): NormalisedSignal[] {
  if (!signals || signals.length === 0) return [];
  return signals.map(normaliseCreditSignal);
}
