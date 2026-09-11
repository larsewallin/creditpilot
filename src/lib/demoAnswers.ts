import type { CIAAnswer } from "@/pages/CIA";

export const DEMO_ANSWERS: Record<string, CIAAnswer> = {
  "Why is Triumph Group flagged across multiple agents?": {
    answer: "Triumph Group is flagged across multiple agents due to **three concurrent risk signals**:\n\n1. **OVERDUE_AR (high)** — $1,100,000 overdue across 3 invoices, worst bucket 61–90 days, oldest 90 days past due (ar_aging_agent, 2026-08-03)\n\n2. **NEWS_EVENT (high)** — Secured a **covenant waiver** after breaching financial covenants; faces margin pressure and elevated leverage raising liquidity concerns (news_monitor_agent, 2026-08-03)\n\n3. **SEC_OTHER (high)** — Covenant waiver disclosed in 10-Q filing dated 2025-02-06 (sec_monitor_agent, 2026-08-03)\n\nAdditionally, the **customers table** shows Triumph Group has a **credit score of 32/100 (CCC+)**, **payment_health=at_risk**, **credit utilization at 55%** of its $2M limit, and risk tags including **MULTI_SIGNAL_RISK, SEC_ALERT, NEGATIVE_NEWS** under a **credit_deterioration scenario** (customers table).",
    sources: [
      { customer_name: "Triumph Group Inc", event_type: "OVERDUE_AR", severity: "high", date: "2026-08-03", agent: "ar_aging_agent", static: true },
      { customer_name: "Triumph Group Inc", event_type: "NEWS_EVENT", severity: "high", date: "2026-08-03", agent: "news_monitor_agent", static: true },
      { customer_name: "Triumph Group Inc", event_type: "SEC_OTHER", severity: "high", date: "2026-08-03", agent: "sec_monitor_agent", static: true },
    ],
    confidence: "High",
    confidence_reason: "Every specific claim in the answer maps directly to the provided data: Triumph Group's OVERDUE_AR event ($1,100,000, 3 invoices, 61–90 days worst bucket, 90 days oldest) is in the credit_events table; NEWS_EVENT and SEC_OTHER events with covenant waiver details are present in credit_events; and all customer attributes (credit_score 32/100 CCC+, payment_health at_risk, utilization 55%, risk_tags, scenario) are verified in the customers table. No unsupported claims are made.",
    relatedQuestions: [
      "Given Triumph Group's covenant breach and recent waiver, what are the specific financial covenants they violated, and when is the next covenant compliance date or waiver expiration?",
      "Of the $1.1M overdue AR across those 3 invoices, which customer accounts are responsible for the largest amounts, and have they indicated payment plans or disputes?",
      "Can you list every individual overdue invoice for Triumph Group with exact invoice numbers and days overdue?",
    ],
  },
  "Which customers have the highest credit risk right now?": {
    answer: "# Highest Credit Risk Customers\n\nSeven customers carry **RISK_FLAG=HIGH** status (customers table):\n\n**Bankruptcy Scenario (Credit Score D/5):**\n- **Rite Aid Corporation**: 97% utilization, $487k balance (customers table)\n- **Proterra Inc**: 76% utilization, $378k balance (customers table)\n- **Yellow Corporation**: 50% utilization, $298k balance (customers table)\n\n**Severe Credit Deterioration (Credit Score CCC/28):**\n- **McDermott International Ltd**: 92% utilization, $1.38M balance (customers table)\n- **Spirit Airlines Inc**: 90% utilization, $1.08M balance (customers table)\n\n**Payment Stress:**\n- **Brixton Fasteners Ltd**: 147% utilization (over limit by $70k), credit score 22/100 (customers table; credit_events table)\n- **Heliogen Inc**: 30% utilization but flagged GOING_CONCERN, credit score 22/100 (customers table)\n\nMost critical: **Rite Aid** (D-rated, 97% utilization), **Brixton Fasteners** (146.7% over-limit), and **McDermott/Spirit** (CCC-rated, 90%+ utilization). Rite Aid, Proterra, and Yellow face **bankruptcy scenarios** (customers table).",
    sources: [
      { customer_name: "Rite Aid Corporation", event_type: "UTILIZATION_THRESHOLD_BREACH", severity: "high", date: "2026-08-03", agent: "ar_aging_agent", static: true },
      { customer_name: "McDermott International Ltd", event_type: "UTILIZATION_THRESHOLD_BREACH", severity: "high", date: "2026-08-03", agent: "ar_aging_agent", static: true },
      { customer_name: "Spirit Airlines Inc", event_type: "UTILIZATION_THRESHOLD_BREACH", severity: "high", date: "2026-08-03", agent: "ar_aging_agent", static: true },
      { customer_name: "Brixton Fasteners Ltd", event_type: "UTILIZATION_THRESHOLD_BREACH", severity: "critical", date: "2026-08-03", agent: "ar_aging_agent", static: true },
    ],
    confidence: "High",
    confidence_reason: "Every specific claim in the answer—all seven HIGH-flag customers, their utilization percentages, balance amounts, credit scores, scenarios, and payment_health statuses—maps directly to rows in the customers table; utilization breaches and event dates are corroborated by the credit_events table; no relationship-status qualifiers mischaracterize any company.",
    relatedQuestions: [
      "For Rite Aid Corporation with 97% utilization and $487k balance, have we established a payment plan or do we need to consider reducing their credit limit immediately?",
      "McDermott International Ltd shows the highest balance at $1.38M with 92% utilization - what is their current payment history and when is their next scheduled payment due?",
      "Should we implement enhanced monitoring or require additional collateral/guarantees from these seven HIGH risk customers before they increase their balances further?",
    ],
  },
  "Should I reduce Arconic's credit limit?": {
    answer: "**Yes, consider reducing Arconic's credit limit.** \n\nArconic shows **multiple warning signs** (customers table):\n\n- **Credit utilization at 92%** ($2,750,000 of $3,000,000 limit) — flagged as HIGH_UTILIZATION (ar_aging_agent, 2026-08-03)\n- **Credit score 58/100 (BB- rating)** indicating elevated risk\n- **Payment health marked \"at_risk\"** \n- **Scenario: credit deterioration**\n- **Risk tags: HIGH_UTILIZATION, NEGATIVE_NEWS**\n\nA reduction would align utilization with healthier benchmarks and mitigate exposure given the deteriorating credit profile. Monitor payment patterns closely before implementing changes.",
    sources: [
      { customer_name: "Arconic Corporation", event_type: "UTILIZATION_THRESHOLD_BREACH", severity: "high", date: "2026-08-03", agent: "ar_aging_agent", static: true },
    ],
    confidence: "Medium",
    confidence_reason: "The answer correctly cites Arconic's utilization (92%), credit score (58/100, BB-), payment_health (at_risk), scenario (credit_deterioration), and risk_tags (HIGH_UTILIZATION, NEGATIVE_NEWS) from the customers table. However, the answer claims the HIGH_UTILIZATION flag was 'flagged as HIGH_UTILIZATION (ar_aging_agent, 2026-08-03)' — this date and agent appear in the credit_events table for Arconic's UTILIZATION_THRESHOLD_BREACH event, but HIGH_UTILIZATION is a risk_tag from the customers table, not a credit event type. The answer conflates the risk_tag with the credit event, creating a minor but specific misattribution of the source of that flag.",
    relatedQuestions: [
      "What is Arconic's current revenue trend, and has the NEGATIVE_NEWS tag been linked to a specific event like the recent bankruptcy filing or operational disruption?",
      "Before reducing the credit limit, should we contact Arconic to understand if the 92% utilization is temporary due to a large order, and what timeline they project for bringing balances down?",
      "If we reduce Arconic's limit from $3,000,000, what level would you recommend, and should we implement a stepped reduction or hold it at a lower threshold pending improvement in their BB- credit score?",
    ],
  },
  "What negative news have we seen recently?": {
    answer: "## Recent Negative News (as of 2026-08-03)\n\n**Critical severity events:**\n- **Northgate Fabrication** faces insolvency risk after its largest customer terminated a multi-year contract, representing a substantial share of annual revenue (credit_events: NEWS_EVENT) (news_monitor_agent on 2026-08-03)\n- **Heliogen Inc** liquidity concerns mounting; cash runway may fall below three quarters absent new financing with no announced capital raise (credit_events: NEWS_EVENT)\n- **Arconic Corporation** placed on negative watch by Moody's citing weakening margins and elevated leverage; potential downgrade could trigger covenant pressure (negative_news_table, 2026-04-30; credit_events: NEWS_EVENT)\n\n**High severity:**\n- **Atlas Precision Manufacturing** cash flow under pressure from prolonged supply chain disruptions and inflated input costs; heavy revolving credit facility draws over past two quarters (credit_events: NEWS_EVENT)\n\n**Combined with overdue AR and credit utilization breaches** across multiple accounts (credit_events: OVERDUE_AR, UTILIZATION_THRESHOLD_BREACH).",
    sources: [
      { customer_name: "Arconic Corporation", event_type: "NEWS_EVENT", severity: "high", date: "2026-08-03", agent: "news_monitor_agent", static: true },
      { customer_name: "Arconic Corporation", event_type: "NEGATIVE_NEWS", severity: "high", date: "2026-04-30", agent: "news_monitor_agent", static: true },
    ],
    confidence: "High",
    confidence_reason: "Every specific claim in the answer maps directly to the provided credit_events table: Northgate Fabrication NEWS_EVENT (critical, 2026-08-03), Heliogen Inc NEWS_EVENT (critical, 2026-08-03), Arconic Corporation negative watch NEWS_EVENT (high, 2026-08-03) plus OVERDUE_AR and UTILIZATION_THRESHOLD_BREACH, and Atlas Precision Manufacturing NEWS_EVENT (high, 2026-08-03) plus UTILIZATION_THRESHOLD_BREACH and OVERDUE_AR all appear with matching dates, severities, and event types in the data.",
    relatedQuestions: [
      "What was the stated reason for Northgate Fabrication's largest customer terminating the contract, and do we have visibility into whether other major customers are at risk?",
      "For Heliogen Inc, what is their current cash position in absolute terms, and have they engaged with any potential financing partners or investors?",
      "Regarding Arconic Corporation, what specific event or development triggered the critical severity alert, and what is their current liquidity status?",
    ],
  },
};
