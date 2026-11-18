/**
 * The data sources CreditPilot reads, one entry per connector, grouped by the kind of
 * data. Settings › Connectors shows them with their status so a company can see what is
 * connected on day one and what to add. Status comes from which settings are present
 * (names only: no value ever leaves the server).
 *
 * Adding a provider: each kind of data has one interface in code (`code`); a new provider
 * implements it and the agents and CIA read its results like the existing ones, because
 * every agent writes the same credit events.
 */

export type ConnectorStatus =
  | "connected"     // its setting is present
  | "default"       // works with the hosted default, no setting needed
  | "built_in"      // no account or key needed
  | "not_set"       // needs a key that is not set
  | "manual"        // entered by the credit team (no API connection yet)
  | "planned";      // not built yet

export interface Connector {
  key: string;
  category: string;
  name: string;
  /** What it feeds, in the product's words. */
  feeds: string;
  /** Settings it reads (names only). Empty for built-in sources. */
  settings: string[];
  kind: "key" | "default_url" | "built_in" | "manual" | "planned";
  /** True when the app works without it (another source covers the same data). */
  optional?: boolean;
  /** Where the interface lives, for a developer adding another provider. */
  code?: string;
  /** In the demo this data is sample data instead. */
  demo_sample?: boolean;
}

export const CATEGORIES: { key: string; label: string; blurb: string }[] = [
  { key: "company", label: "Company data", blurb: "Who the customer is: registers, identifiers, owners, VAT." },
  { key: "sanctions", label: "Sanctions screening", blurb: "Official sanctions lists, refreshed daily." },
  { key: "scores", label: "Credit scores and ratings", blurb: "The score that sets limits. Choose the order in Credit score source." },
  { key: "financials", label: "Financial statements", blurb: "Accounts behind the score and the accounts-age rule." },
  { key: "news", label: "News", blurb: "Stories that name a customer." },
  { key: "filings", label: "SEC filings", blurb: "Covenant breaches, going-concern doubts, executive changes." },
  { key: "industry", label: "Industry data", blurb: "Economic series and news by sector." },
  { key: "country", label: "Country risk", blurb: "Political and economic events, ratings, policy rates, tariffs." },
  { key: "fx", label: "Exchange rates", blurb: "Currency moves on open invoices." },
  { key: "receivables", label: "Receivables and payments", blurb: "Open invoices and payment history." },
  { key: "alerts", label: "Alerts", blurb: "Where the credit team is told about critical events." },
  { key: "ai", label: "AI", blurb: "The assistant's answers and the daily briefing." },
];

export const CONNECTORS: Connector[] = [
  { key: "company_lookup", category: "company", name: "Company Lookup", feeds: "New customers: legal name, registration number, LEI, parent companies, website age, register status",
    settings: ["COMPANY_LOOKUP_URL"], kind: "default_url", code: "_shared/onboarding/live_providers.ts (lookup)" },
  { key: "companies_house", category: "company", name: "Companies House (UK)", feeds: "New customers in the UK: officers and owners (PSC)",
    settings: ["COMPANIES_HOUSE_API_KEY"], kind: "key", optional: true },
  { key: "hmrc_vat", category: "company", name: "HMRC VAT (UK)", feeds: "New customers in the UK: VAT number check",
    settings: ["HMRC_CLIENT_ID", "HMRC_CLIENT_SECRET"], kind: "key", optional: true },
  { key: "vies", category: "company", name: "EU VIES", feeds: "New customers in the EU: VAT number check", settings: [], kind: "built_in" },
  { key: "dnb_company", category: "company", name: "D&B, Creditsafe or another company database", feeds: "Company identity from your own provider instead of Company Lookup",
    settings: [], kind: "planned", optional: true, code: "_shared/onboarding/types.ts (OnboardingProviders.lookup)" },

  { key: "sanctions_lists", category: "sanctions", name: "OFAC, EU, UN and UK lists", feeds: "New customers and their owners are screened; lists sync daily", settings: [], kind: "built_in" },

  { key: "third_party_scores", category: "scores", name: "D&B, Creditsafe, Coface, Allianz Trade, Experian, other ratings", feeds: "Default: the provider's report attached on the application, with the score or rating it gives",
    settings: [], kind: "manual", code: "_shared/onboarding/score_providers.ts (fetch hook for an API connection)" },
  { key: "keen", category: "scores", name: "Keen", feeds: "Score (0–100) from a company's financial statements. Paused until fully developed (KEEN_IN_ONBOARDING)",
    settings: ["KEEN_API_KEY", "KEEN_API_URL"], kind: "planned", code: "_shared/onboarding/score_providers.ts" },

  { key: "sec_edgar_financials", category: "financials", name: "SEC EDGAR (US-listed)", feeds: "Latest 10-K figures for the limit caps", settings: [], kind: "built_in" },
  { key: "fmp_financials", category: "financials", name: "Financial Modeling Prep", feeds: "Financials of listed companies outside the US", settings: ["FMP_API_KEY"], kind: "key", optional: true },

  { key: "tavily", category: "news", name: "Tavily news search", feeds: "News agent: web news naming each customer", settings: ["TAVILY_API_KEY"], kind: "key", optional: true,
    code: "_shared/skills/integration/search-news.ts (NewsProvider)", demo_sample: true },
  { key: "tcm_news", category: "news", name: "Trade Credit Monitor", feeds: "News agent: insolvency notices and trade-credit stories naming a customer", settings: ["TCM_API_URL"], kind: "default_url",
    code: "_shared/skills/integration/trade-credit-monitor.ts", demo_sample: true },

  { key: "sec_edgar", category: "filings", name: "SEC EDGAR", feeds: "SEC agent: new 8-K, 10-Q and 10-K filings of US-listed customers", settings: [], kind: "built_in", demo_sample: true },

  { key: "fred_bls", category: "industry", name: "FRED and BLS", feeds: "Industry agent: economic series per sector", settings: ["FRED_API_KEY"], kind: "key",
    code: "_shared/skills/integration (IndustrySignalSource)", demo_sample: true },
  { key: "gdelt", category: "industry", name: "GDELT", feeds: "Industry agent: sector news", settings: [], kind: "built_in", demo_sample: true },

  { key: "tcm_country", category: "country", name: "Trade Credit Monitor", feeds: "Country agent: political and economic events in your customers' countries", settings: ["TCM_API_URL"], kind: "default_url", demo_sample: true },
  { key: "country_ratings", category: "country", name: "Sovereign ratings and policy rates", feeds: "Country agent: rating changes, central bank rates, tariffs",
    settings: [], kind: "planned", code: "country-risk-agent (fetchLiveCountryRisk)", demo_sample: true },

  { key: "fmp_fx", category: "fx", name: "Financial Modeling Prep", feeds: "FX agent: daily rates for invoice currencies", settings: ["FMP_API_KEY"], kind: "key",
    code: "_shared/skills/integration/fetch-fx-rates.ts", demo_sample: true },

  { key: "ar_csv", category: "receivables", name: "AR aging file (CSV)", feeds: "AR Aging page: open invoices; the AR and payment agents read them", settings: [], kind: "built_in" },
  { key: "erp", category: "receivables", name: "ERP / accounting system (NetSuite, SAP, QuickBooks…)", feeds: "Invoices and payments straight from your system", settings: [], kind: "planned", optional: true },

  { key: "email", category: "alerts", name: "Email (SendGrid)", feeds: "Critical events and proposed actions to the credit team", settings: ["SENDGRID_API_KEY", "CREDIT_TEAM_EMAIL"], kind: "key", optional: true },
  { key: "teams", category: "alerts", name: "Microsoft Teams", feeds: "The same alerts in a Teams channel", settings: ["TEAMS_WEBHOOK_URL"], kind: "key", optional: true },
  { key: "slack", category: "alerts", name: "Slack", feeds: "The same alerts in a Slack channel", settings: ["SLACK_WEBHOOK_URL"], kind: "key", optional: true },

  { key: "anthropic", category: "ai", name: "Anthropic Claude", feeds: "Questions about the portfolio, the daily briefing, news classification", settings: ["ANTHROPIC_API_KEY"], kind: "key" },
];

export interface ConnectorView extends Connector { status: ConnectorStatus; missing: string[] }

/** Status of every connector from which settings are present. */
export function connectorStatuses(has: (name: string) => boolean): ConnectorView[] {
  return CONNECTORS.map((c) => {
    const missing = c.settings.filter((n) => !has(n));
    let status: ConnectorStatus;
    if (c.kind === "built_in") status = "built_in";
    else if (c.kind === "manual") status = "manual";
    else if (c.kind === "planned") status = "planned";
    else if (c.kind === "default_url") status = missing.length ? "default" : "connected";
    else status = missing.length === 0 ? "connected" : "not_set";
    if (c.key === "email") status = has("SENDGRID_API_KEY") ? "connected" : "not_set";
    return { ...c, status, missing: status === "connected" ? [] : missing };
  });
}
