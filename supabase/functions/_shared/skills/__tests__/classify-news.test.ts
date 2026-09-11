import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyNews } from "../generative/classify-news";

const MOCK_API_KEY = "sk-ant-test-key";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

function claudeBody(text: string) {
  return { content: [{ type: "text", text }] };
}

function validJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    severity: "high",
    category: "restructuring",
    sentiment_score: -0.7,
    confidence: 0.9,
    reasoning: "Company announced major layoffs",
    ...overrides,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("classifyNews", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 1. Valid Claude JSON → classified_by = 'claude' ───────────────────────

  it("returns correct fields from valid Claude JSON with classified_by = 'claude'", async () => {
    vi.stubGlobal("fetch", makeFetch(claudeBody(validJson())));

    const result = await classifyNews({
      headline: "Acme Corp announces 2,000 layoffs",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.classified_by).toBe("claude");
    expect(result.severity).toBe("high");
    expect(result.category).toBe("restructuring");
    expect(result.sentiment_score).toBe(-0.7);
    expect(result.confidence).toBe(0.9);
    expect(result.reasoning).toBe("Company announced major layoffs");
  });

  // ── 2. Invalid JSON from Claude → falls back to keyword ──────────────────

  it("falls back to keyword classifier on invalid JSON from Claude", async () => {
    vi.stubGlobal("fetch", makeFetch(claudeBody("This is definitely not JSON")));

    const result = await classifyNews({
      headline: "Acme Corp files for chapter 11 bankruptcy",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.classified_by).toBe("fallback");
    expect(result.severity).toBe("critical"); // "chapter 11" keyword
  });

  // ── 3. Severity not in enum → falls back ─────────────────────────────────

  it("falls back when severity is not in the allowed enum", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(claudeBody(validJson({ severity: "urgent" })))
    );

    const result = await classifyNews({
      headline: "Acme Corp announces restructuring",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.classified_by).toBe("fallback");
  });

  // ── 4. No API key → keyword classifier ───────────────────────────────────

  it("uses keyword classifier when no API key is provided", async () => {
    const result = await classifyNews({
      headline: "Acme Corp files for chapter 11 bankruptcy",
      company_name: "Acme Corp",
      // no anthropic_api_key
    });

    expect(result.classified_by).toBe("keyword");
    expect(result.severity).toBe("critical");
  });

  // ── 5. Bankruptcy keyword → critical ─────────────────────────────────────

  it("detects bankruptcy keyword and returns critical severity", async () => {
    const result = await classifyNews({
      headline: "Acme Corp files for bankruptcy protection",
      company_name: "Acme Corp",
    });

    expect(result.severity).toBe("critical");
    expect(result.category).toBe("bankruptcy");
    expect(result.classified_by).toBe("keyword");
  });

  // ── 6. Empty headline → no throw ─────────────────────────────────────────

  it("returns a valid result without throwing on empty headline", async () => {
    const result = await classifyNews({
      headline: "",
      company_name: "Acme Corp",
    });

    expect(result).toBeDefined();
    expect(typeof result.severity).toBe("string");
    expect(typeof result.classified_by).toBe("string");
    expect(() => result).not.toThrow();
  });

  // ── 7. Low confidence → result still returned (threshold is agent's job) ─

  it("returns result even when confidence is below threshold", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(claudeBody(validJson({ confidence: 0.3, severity: "medium", category: "other" })))
    );

    const result = await classifyNews({
      headline: "Acme Corp hires new VP of Marketing",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
      confidence_threshold: 0.7, // informational only
    });

    expect(result).toBeDefined();
    expect(result.confidence).toBe(0.3);
    expect(result.classified_by).toBe("claude");
  });

  // ── Additional: category not in enum → fallback ───────────────────────────

  it("falls back when category is not in the allowed enum", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(claudeBody(validJson({ category: "unknown_category" })))
    );

    const result = await classifyNews({
      headline: "Acme Corp revenue declines sharply",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.classified_by).toBe("fallback");
  });

  // ── Additional: HTTP error from Claude → fallback ─────────────────────────

  it("falls back to keyword on non-OK HTTP response from Claude", async () => {
    vi.stubGlobal("fetch", makeFetch({}, false, 500));

    const result = await classifyNews({
      headline: "Acme Corp announces layoffs and restructuring",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.classified_by).toBe("fallback");
    expect(result.severity).toBe("high"); // "layoffs" keyword
  });

  // ── Additional: sentiment_score clamped to ≤ 0 ───────────────────────────

  it("clamps positive sentiment_score to 0", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(
        claudeBody(
          validJson({ sentiment_score: 0.5, severity: "low", category: "other" })
        )
      )
    );

    const result = await classifyNews({
      headline: "Acme Corp reports minor update",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.sentiment_score).toBe(0);
  });

  // ── Additional: confidence clamped to 0–1 ────────────────────────────────

  it("clamps out-of-range confidence to 0–1", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch(claudeBody(validJson({ confidence: 1.5 })))
    );

    const result = await classifyNews({
      headline: "Acme Corp announces something",
      company_name: "Acme Corp",
      anthropic_api_key: MOCK_API_KEY,
    });

    expect(result.confidence).toBe(1);
  });

  // ── Additional: layoffs keyword → high severity ──────────────────────────

  it("detects layoffs keyword and returns high severity", async () => {
    const result = await classifyNews({
      headline: "Acme Corp announces massive layoffs as revenue declines",
      company_name: "Acme Corp",
    });

    expect(result.severity).toBe("high");
    expect(result.classified_by).toBe("keyword");
  });
});
