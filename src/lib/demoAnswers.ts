import type { CIAAnswer } from "@/pages/CIA";

// Fixed answers for the demo's suggested questions (saves AI tokens). Written from live
// CIA answers on the demo data on 2026-11-17 and checked against that data. No dates:
// the demo replays daily with today's dates. Re-check when the demo data changes.
export const DEMO_ANSWERS: Record<string, CIAAnswer> = {
  "Why is Triumph Group flagged across multiple agents?": {
    "answer": "Triumph Group is flagged by **5 agents** due to converging credit deterioration signals:\n\n1. **News monitoring** – Covenant waiver disclosed; lenders waived financial covenants due to breached leverage ratios \n2. **AR aging** – $800,000 overdue across 2 invoices, with worst bucket 61–90 days past due \n3. **Payment behavior** – Average days late worsened from 12 to 28 days (+16.0 day swing) over 90 days \n4. **SEC filings** – Covenant waiver confirmed in 10-Q filing \n5. **Credit rating** – Score downgraded 15 points to CCC+ (32/100) ",
    "sources": [
      {
        "customer_name": "Triumph Group Inc",
        "event_type": "NEWS_EVENT",
        "severity": "high",
        "agent": "news_monitor_agent",
        "static": true
      },
      {
        "customer_name": "Triumph Group Inc",
        "event_type": "OVERDUE_AR",
        "severity": "high",
        "agent": "ar_aging_agent",
        "static": true
      },
      {
        "customer_name": "Triumph Group Inc",
        "event_type": "PAYMENT_DETERIORATION",
        "severity": "high",
        "agent": "payment_behaviour_agent",
        "static": true
      },
      {
        "customer_name": "Triumph Group Inc",
        "event_type": "SEC_OTHER",
        "severity": "high",
        "agent": "sec_monitor_agent",
        "static": true
      },
      {
        "customer_name": "Triumph Group Inc",
        "event_type": "CREDIT_RATING_DOWNGRADE",
        "severity": "high",
        "agent": "credit_rating_agent",
        "static": true
      }
    ],
    "confidence": "High",
    "confidence_reason": "Every claim maps to the demo data: five agents flag Triumph Group (news, AR aging, payment behaviour, SEC filings, credit score); $800,000 overdue across 2 invoices in the 61–90 day bucket; average days late 12 → 28; score 32/100 (CCC+).",
    "relatedQuestions": [
      "Given the covenant waiver and leverage ratio breach, what are Triumph Group's current liquidity levels and cash flow projections for the next 2 quarters?",
      "Of the $800,000 in overdue AR, do we know if these invoices are tied to specific contract performance issues or are they indicative of broader cash flow problems across their business?",
      "Has Triumph Group provided any restructuring plan or timeline for covenant compliance, and should we consider reducing credit limits or requiring additional collateral immediately?"
    ]
  },
  "Which customers have the highest credit risk right now?": {
    "answer": "**19 customers** currently meet the high-risk criteria (combined credit limit $18,300,000, combined exposure $16,233,000):\n- **Arconic Corporation** — credit_score=58/100, scenario=credit_deterioration, exposure $2,750,000 \n- **General Electric Company (Power segment)** — credit_score=60/100, scenario=credit_deterioration, exposure $2,200,000 \n- **McDermott International Ltd** — credit_score=28/100, scenario=credit_deterioration, exposure $1,380,000 \n- **Maxar Technologies Inc** — credit_score=52/100, scenario=negative_news, exposure $1,250,000 \n- **Atlas Precision Manufacturing** — credit_score=32/100, scenario=credit_deterioration, exposure $1,200,000 \n- **Spirit Airlines Inc** — credit_score=28/100, scenario=negative_news, exposure $1,080,000 \n- **Cascade Industrial Systems** — credit_score=38/100, scenario=payment_issues, exposure $980,000 \n- **Coeur Mining Inc** — credit_score=42/100, scenario=credit_deterioration, exposure $890,000 \n- **Superior Industries International Inc** — credit_score=42/100, scenario=credit_deterioration, exposure $720,000 \n- **Orbital Energy Group Inc** — credit_score=32/100, scenario=payment_issues, exposure $680,000 \n- **Mistras Group Inc** — credit_score=45/100, scenario=credit_deterioration, exposure $545,000 \n- **Rite Aid Corporation** — credit_score=5/100, scenario=bankruptcy, exposure $487,000 \n- **Vertex Energy Inc** — credit_score=32/100, scenario=payment_issues, exposure $445,000 \n- **Proterra Inc** — credit_score=5/100, scenario=bankruptcy, exposure $378,000 \n- **Liqtech International AS** — credit_score=42/100, scenario=negative_news, exposure $365,000 \n- **Yellow Corporation** — credit_score=5/100, scenario=bankruptcy, exposure $298,000 \n- **Brixton Fasteners Ltd** — credit_score=22/100, scenario=payment_issues, exposure $220,000 \n- **Ironwood Machine Works** — credit_score=33/100, scenario=payment_issues, exposure $185,000 \n- **Heliogen Inc** — credit_score=22/100, scenario=sec_filing_monitoring, exposure $180,000 \n\nThe portfolio carries **combined exposure of $16.23M against $18.3M in credit limits** across this high-risk set. Critical concerns include three **bankruptcy-scenario accounts** and two customers **over their credit limits**: Cascade Industrial Systems at 196% utilization and Brixton Fasteners Ltd at 147%.",
    "sources": [
      {
        "customer_name": "Arconic Corporation",
        "severity": "high",
        "static": true,
        "source_type": "customers",
        "event_type": null,
        "agent": null
      },
      {
        "customer_name": "McDermott International Ltd",
        "severity": "high",
        "static": true,
        "source_type": "customers",
        "event_type": null,
        "agent": null
      },
      {
        "customer_name": "Rite Aid Corporation",
        "severity": "high",
        "static": true,
        "source_type": "customers",
        "event_type": null,
        "agent": null
      },
      {
        "customer_name": "Cascade Industrial Systems",
        "severity": "high",
        "static": true,
        "source_type": "customers",
        "event_type": null,
        "agent": null
      },
      {
        "customer_name": "Brixton Fasteners Ltd",
        "severity": "high",
        "static": true,
        "source_type": "customers",
        "event_type": null,
        "agent": null
      }
    ],
    "confidence": "High",
    "confidence_reason": "Every specific claim in the answer (all 19 company names, credit scores, scenarios, exposures, credit limits, utilization percentages, and aggregate figures) maps directly to rows in the CUSTOMERS TABLE and OFFICIAL HIGH-RISK CUSTOMER LIST. The data is internally consistent: combined credit limit $18.3M and combined exposure $16.233M match the official list totals; all individual scores, scenarios, and utilization rates are verified; and the two over-limit accounts (Cascade Industrial Systems at 196%, Brixton Fasteners Ltd at 147%) and three bankruptcy scenarios (Rite Aid, Proterra, Yellow) are all confirmed in the source data.",
    "relatedQuestions": [
      "Given Arconic's credit_score of 58 and $2.75M exposure, what specific collateral or payment term adjustments should we implement to mitigate the credit deterioration risk?",
      "McDermott International has a critically low score of 28—should we consider reducing their credit limit or requiring a third-party guarantee before additional shipments?",
      "With 19 customers at high-risk totaling $16.2M in exposure, do we have concentration limits being breached, and should we escalate any accounts for immediate collection review?"
    ]
  },
  "Should I reduce Arconic's credit limit?": {
    "answer": "Yes, **reducing Arconic's credit limit is prudent**. The company exhibits converging, high-severity risk signals:\n\n**Credit utilization:** 92%, with utilization flagged at 91.7%.\n\n**Payment deterioration:** Average days late rose from 20.3 to 40 days over the past 90 days (+19.7 day swing). Recent payments show worsening timeliness: 46 days late, 39 days late, 35 days late. On-time rate is only 12.5%.\n\n**Credit rating & news:** Credit score of 58/100 (BB-). News reports Arconic was placed on negative watch, citing weakening margins and elevated leverage.\n\n**Overdue AR:** $2,250,000 overdue across 3 invoices (oldest 75 days past due).\n\n**Multi-signal convergence:** Flagged by 3 agents (ar_aging, news_monitor, payment_behaviour). The account is marked at_risk with MULTI_SIGNAL_RISK flagging.\n\nConsider reducing the limit proportionally to recent drawdown patterns and implement enhanced monitoring.",
    "sources": [
      {
        "customer_name": "Arconic Corporation",
        "event_type": "UTILIZATION_THRESHOLD_BREACH",
        "severity": "high",
        "agent": "ar_aging_agent",
        "static": true
      },
      {
        "customer_name": "Arconic Corporation",
        "event_type": "PAYMENT_DETERIORATION",
        "severity": "high",
        "agent": "payment_behaviour_agent",
        "static": true
      },
      {
        "customer_name": "Arconic Corporation",
        "event_type": "OVERDUE_AR",
        "severity": "high",
        "agent": "ar_aging_agent",
        "static": true
      },
      {
        "customer_name": "Arconic Corporation",
        "event_type": "NEWS_EVENT",
        "severity": "high",
        "agent": "news_monitor_agent",
        "static": true
      }
    ],
    "confidence": "High",
    "confidence_reason": "Every claim maps to the demo data: 92% utilization ($2.75M of $3M), days late 20.3 → 40 with a 12.5% on-time rate, score 58/100 (BB-), $2,250,000 overdue across 3 invoices, and three agents flagging the account.",
    "relatedQuestions": [
      "What limit would bring Arconic's utilization back below 75%?",
      "Which of Arconic's overdue invoices are the oldest?",
      "Which other customers are flagged by three or more agents?"
    ]
  },
  "What negative news have we seen recently?": {
    "answer": "## Recent negative news\n\nFive news items flag portfolio customers (news monitoring agent):\n\n**Critical**\n- **Northgate Fabrication**: insolvency risk after its largest customer ended a multi-year supply contract, a substantial share of annual revenue.\n- **Heliogen Inc**: liquidity concerns; its cash runway may fall below three quarters without new financing, and no capital raise has been announced.\n\n**High**\n- **Triumph Group Inc**: covenant waiver from lenders after breaching financial covenants, with continued margin pressure and elevated leverage.\n- **Arconic Corporation**: placed on negative watch, citing weakening margins and elevated leverage; a downgrade could trigger covenant pressure.\n- **Atlas Precision Manufacturing**: cash flow under pressure from supply chain disruption and higher input costs, after heavy revolving credit draws over the past two quarters.\n\nFour of the five are also flagged by other agents: Heliogen, Triumph Group, Arconic and Atlas Precision show overdue invoices, slower payments or a lower credit score as well. Northgate Fabrication is flagged by the news only.",
    "sources": [
      {
        "customer_name": "Northgate Fabrication",
        "event_type": "NEWS_EVENT",
        "severity": "critical",
        "agent": "news_monitor_agent",
        "static": true
      },
      {
        "customer_name": "Heliogen Inc",
        "event_type": "NEWS_EVENT",
        "severity": "critical",
        "agent": "news_monitor_agent",
        "static": true
      },
      {
        "customer_name": "Triumph Group Inc",
        "event_type": "NEWS_EVENT",
        "severity": "high",
        "agent": "news_monitor_agent",
        "static": true
      },
      {
        "customer_name": "Arconic Corporation",
        "event_type": "NEWS_EVENT",
        "severity": "high",
        "agent": "news_monitor_agent",
        "static": true
      },
      {
        "customer_name": "Atlas Precision Manufacturing",
        "event_type": "NEWS_EVENT",
        "severity": "high",
        "agent": "news_monitor_agent",
        "static": true
      }
    ],
    "confidence": "High",
    "confidence_reason": "The five items are the demo's news records, with their severities; the other-agent flags come from the same customers' events.",
    "relatedQuestions": [
      "Why is Triumph Group flagged across multiple agents?",
      "How much do we have outstanding with Northgate Fabrication?",
      "Should I reduce Arconic's credit limit?"
    ]
  }
};
