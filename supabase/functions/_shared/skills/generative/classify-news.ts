/**
 * @skill classify-news
 * @type generative
 * @description Classifies a news article for credit risk relevance using Claude Haiku.
 *   Returns severity, a standardised category, sentiment score, confidence, and reasoning.
 *
 *   Classification flow:
 *     1. If anthropic_api_key provided → call Claude Haiku with strict JSON schema prompt.
 *     2. Validate all fields against allowed enums. If invalid → classified_by = 'fallback'.
 *     3. If no API key or any failure → keyword classifier, classified_by = 'keyword'.
 *
 *   Never throws. Always returns a ClassifyNewsResult.
 *   Confidence threshold filtering is the caller's (agent's) responsibility.
 *
 * @input ClassifyNewsInput — headline, optional summary/source/company_name,
 *   optional confidence_threshold (informational only — not applied here)
 * @output ClassifyNewsResult — severity, category, sentiment_score, confidence,
 *   optional reasoning, classified_by ('claude' | 'keyword' | 'fallback')
 * @usedBy news-monitor-agent
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NewsSeverity = "critical" | "high" | "medium" | "low";

export type NewsCategory =
  | "bankruptcy"
  | "fraud_legal"
  | "restructuring"
  | "financial_results"
  | "executive_change"
  | "credit_rating"
  | "operational"
  | "other";

export type ClassifiedBy = "claude" | "keyword" | "fallback";

export interface ClassifyNewsInput {
  headline: string;
  summary?: string;
  source?: string;
  company_name: string;
  anthropic_api_key?: string;
  /** Informational only — classifyNews always returns a result regardless of confidence. */
  confidence_threshold?: number;
}

export interface ClassifyNewsResult {
  severity: NewsSeverity;
  category: NewsCategory;
  sentiment_score: number; // -1.0 to 0.0
  confidence: number;      // 0.0 to 1.0
  reasoning?: string;
  classified_by: ClassifiedBy;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_SEVERITIES: ReadonlyArray<string> = ["critical", "high", "medium", "low"];

const VALID_CATEGORIES: ReadonlyArray<string> = [
  "bankruptcy",
  "fraud_legal",
  "restructuring",
  "financial_results",
  "executive_change",
  "credit_rating",
  "operational",
  "other",
];

const CRITICAL_KEYWORDS = [
  "bankruptcy", "chapter 11", "chapter 7", "insolvency", "liquidation",
  "default", "receivership", "going concern", "fraud", "sec investigation",
  "delisted", "criminal charges", "class action",
];

const HIGH_KEYWORDS = [
  "layoffs", "restructuring", "downgrade", "credit rating cut", "net loss",
  "revenue decline", "profit warning", "covenant breach", "debt refinancing",
  "ceo resign", "executive departure", "material weakness",
];

const SYSTEM_PROMPT = `You are a B2B credit risk analyst. Classify news articles for credit risk impact.

You must respond with ONLY valid JSON matching this exact schema:
{
  "severity": "critical" | "high" | "medium" | "low",
  "category": "bankruptcy" | "fraud_legal" | "restructuring" | "financial_results" | "executive_change" | "credit_rating" | "operational" | "other",
  "sentiment_score": number between -1.0 and 0.0,
  "confidence": number between 0.0 and 1.0,
  "reasoning": "one sentence max"
}
Do not include any text outside the JSON object.`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function classifyNews(
  input: ClassifyNewsInput
): Promise<ClassifyNewsResult> {
  if (!input.anthropic_api_key) {
    return keywordClassify(input.headline, input.summary, "keyword");
  }

  try {
    const userContent = [
      `Company: ${input.company_name}`,
      `Headline: ${input.headline}`,
      input.summary ? `Summary: ${input.summary}` : null,
      input.source ? `Source: ${input.source}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.anthropic_api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!response.ok) {
      return fallbackClassify(input.headline, input.summary);
    }

    const data = await response.json();
    const rawText: string = data.content?.[0]?.text ?? "";

    // Strip any accidental code fences
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return fallbackClassify(input.headline, input.summary);
    }

    // Validate all required fields and enum memberships
    if (
      !VALID_SEVERITIES.includes(parsed.severity as string) ||
      !VALID_CATEGORIES.includes(parsed.category as string) ||
      typeof parsed.sentiment_score !== "number" ||
      typeof parsed.confidence !== "number"
    ) {
      return fallbackClassify(input.headline, input.summary);
    }

    return {
      severity: parsed.severity as NewsSeverity,
      category: parsed.category as NewsCategory,
      sentiment_score: Math.max(-1, Math.min(0, parsed.sentiment_score as number)),
      confidence: Math.max(0, Math.min(1, parsed.confidence as number)),
      reasoning:
        typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
      classified_by: "claude",
    };
  } catch {
    return fallbackClassify(input.headline, input.summary);
  }
}

// ─── Keyword classifier ───────────────────────────────────────────────────────

function keywordClassify(
  headline: string,
  summary?: string,
  classifiedBy: ClassifiedBy = "keyword"
): ClassifyNewsResult {
  if (!headline) {
    return {
      severity: "low",
      category: "other",
      sentiment_score: -0.1,
      confidence: 0.2,
      classified_by: classifiedBy,
    };
  }

  const text = `${headline} ${summary ?? ""}`.toLowerCase();
  const isCritical = CRITICAL_KEYWORDS.some((kw) => text.includes(kw));
  const isHigh = HIGH_KEYWORDS.some((kw) => text.includes(kw));

  if (isCritical) {
    return {
      severity: "critical",
      category: detectCategory(text),
      sentiment_score: -0.9,
      confidence: 0.6,
      classified_by: classifiedBy,
    };
  }
  if (isHigh) {
    return {
      severity: "high",
      category: detectCategory(text),
      sentiment_score: -0.6,
      confidence: 0.6,
      classified_by: classifiedBy,
    };
  }
  return {
    severity: "medium",
    category: detectCategory(text),
    sentiment_score: -0.3,
    confidence: 0.4,
    classified_by: classifiedBy,
  };
}

/** Claude was attempted but the response failed validation — use keyword logic, flag as fallback. */
function fallbackClassify(headline: string, summary?: string): ClassifyNewsResult {
  return keywordClassify(headline, summary, "fallback");
}

function detectCategory(text: string): NewsCategory {
  if (
    text.includes("bankrupt") ||
    text.includes("chapter 11") ||
    text.includes("insolvenc") ||
    text.includes("liquidat")
  )
    return "bankruptcy";
  if (
    text.includes("fraud") ||
    text.includes("sec investigation") ||
    text.includes("criminal") ||
    text.includes("class action")
  )
    return "fraud_legal";
  if (text.includes("layoff") || text.includes("restructur"))
    return "restructuring";
  if (
    text.includes("revenue") ||
    text.includes("profit") ||
    text.includes("loss") ||
    text.includes("earnings")
  )
    return "financial_results";
  if (
    text.includes("ceo") ||
    text.includes("executive") ||
    text.includes("resign") ||
    text.includes("departure")
  )
    return "executive_change";
  if (text.includes("downgrade") || text.includes("credit rating") || text.includes("rating cut"))
    return "credit_rating";
  return "other";
}
