-- Demo seed data for pending_actions and credit_events
-- Uses real customer IDs from v_ar_aging_current
-- Seed run ID matches the ar-aging-agent DEMO_MODE constant

-- ── pending_actions seed ────────────────────────────────────────────────────
-- 3 CREDIT_LIMIT_REDUCTION actions for high-utilization customers

INSERT INTO public.pending_actions (id, run_id, customer_id, agent_name, action_type, rationale, current_value, proposed_value, status, created_at)
VALUES
  (
    'a0000001-0000-0000-0000-000000000001',
    '0aa07788-5801-48ad-b070-384389296dee',
    'c0000001-0000-0000-0000-000000000029',  -- Arconic Corporation (91.7% util)
    'ar_aging_agent',
    'CREDIT_LIMIT_REDUCTION',
    'Critical utilization (91.7%) with deteriorating payment behaviour. Limit reduction to protect exposure.',
    3000000,
    2250000,
    'pending',
    now() - interval '2 hours'
  ),
  (
    'a0000001-0000-0000-0000-000000000002',
    '0aa07788-5801-48ad-b070-384389296dee',
    'c0000001-0000-0000-0000-000000000008',  -- Howmet Aerospace (71.1% util)
    'ar_aging_agent',
    'CREDIT_LIMIT_REDUCTION',
    'High utilization (71.1%) combined with grey-zone Altman Z score and declining on-time payment rate.',
    4500000,
    3375000,
    'pending',
    now() - interval '2 hours'
  ),
  (
    'a0000001-0000-0000-0000-000000000003',
    '0aa07788-5801-48ad-b070-384389296dee',
    'c0000001-0000-0000-0000-000000000005',  -- Precision Castparts (76% util)
    'ar_aging_agent',
    'CREDIT_LIMIT_REDUCTION',
    'Elevated utilization (76%) with concentration risk (8.2% of portfolio). Proactive limit reduction recommended.',
    5000000,
    3750000,
    'pending',
    now() - interval '2 hours'
  )
ON CONFLICT (id) DO UPDATE SET status = 'pending';

-- ── credit_events seed ──────────────────────────────────────────────────────

INSERT INTO public.credit_events (id, scope, customer_id, event_type, source_agent, severity, signal_type, title, description, payload, action_required, action_type, action_status, cia_processed, run_id, created_at)
VALUES
  (
    'e0000001-0000-0000-0000-000000000001',
    'customer',
    'c0000001-0000-0000-0000-000000000029',
    'CRITICAL_UTILIZATION',
    'ar_aging_agent',
    'critical',
    'AR_AGING',
    'Arconic Corporation: CRITICAL UTILIZATION',
    'Credit utilization at 91.7% ($2.75M / $3M limit). Above critical threshold.',
    '{"utilization_pct": 91.7, "credit_limit": 3000000, "dunning_stage": 1, "altman_z_zone": "grey"}',
    true,
    'CREDIT_LIMIT_REDUCTION',
    'pending',
    false,
    '0aa07788-5801-48ad-b070-384389296dee',
    now() - interval '2 hours'
  ),
  (
    'e0000001-0000-0000-0000-000000000002',
    'customer',
    'c0000001-0000-0000-0000-000000000049',
    'GOING_CONCERN_WARNING',
    'sec_monitor_agent',
    'critical',
    'SEC_FILING',
    'Heliogen Inc: GOING CONCERN WARNING',
    'Risk signals detected in SEC filing: going_concern_warning, cash_runway_<3_quarters',
    '{"filing_type": "10-K", "risk_signals": ["going_concern_warning", "cash_runway_<3_quarters"], "triggers": ["going_concern_warning", "cash_runway_<3_quarters"]}',
    false,
    null,
    'none',
    false,
    '04238087-3999-4aac-a368-5a820a603194',
    now() - interval '3 hours'
  ),
  (
    'e0000001-0000-0000-0000-000000000003',
    'customer',
    'c0000001-0000-0000-0000-000000000008',
    'HIGH_UTILIZATION',
    'ar_aging_agent',
    'high',
    'AR_AGING',
    'Howmet Aerospace Inc: HIGH UTILIZATION',
    'Credit utilization at 71.1% ($3.2M / $4.5M limit). Payment on-time rate declining.',
    '{"utilization_pct": 71.1, "credit_limit": 4500000, "dunning_stage": 1, "altman_z_zone": "grey"}',
    true,
    'CREDIT_LIMIT_REDUCTION',
    'pending',
    false,
    '0aa07788-5801-48ad-b070-384389296dee',
    now() - interval '2 hours'
  ),
  (
    'e0000001-0000-0000-0000-000000000004',
    'customer',
    'c0000001-0000-0000-0000-000000000021',
    'COVENANT_WAIVER',
    'sec_monitor_agent',
    'high',
    'SEC_FILING',
    'Triumph Group: COVENANT WAIVER',
    'Risk signals detected in SEC filing: covenant_waiver',
    '{"filing_type": "10-Q", "risk_signals": ["covenant_waiver"], "triggers": ["covenant_waiver"]}',
    false,
    null,
    'none',
    false,
    '04238087-3999-4aac-a368-5a820a603194',
    now() - interval '3 hours'
  ),
  (
    'e0000001-0000-0000-0000-000000000005',
    'customer',
    'c0000001-0000-0000-0000-000000000005',
    'HIGH_UTILIZATION',
    'ar_aging_agent',
    'high',
    'AR_AGING',
    'Precision Castparts Corp: HIGH UTILIZATION',
    'Credit utilization at 76% ($3.8M / $5M limit). Concentration risk at 8.2% of portfolio.',
    '{"utilization_pct": 76.0, "credit_limit": 5000000, "dunning_stage": 1, "concentration_pct": 8.2}',
    true,
    'CREDIT_LIMIT_REDUCTION',
    'pending',
    false,
    '0aa07788-5801-48ad-b070-384389296dee',
    now() - interval '2 hours'
  ),
  (
    'e0000001-0000-0000-0000-000000000006',
    'customer',
    'c0000001-0000-0000-0000-000000000021',
    'NEGATIVE_NEWS_HIGH',
    'news_monitor_agent',
    'high',
    'NEGATIVE_NEWS',
    'Heliogen Inc: Liquidity concerns flagged by analysts',
    'Analyst report cites deteriorating cash position and risk of covenant breach in Q3.',
    '{"headline": "Heliogen liquidity concerns mount as runway shrinks", "source": "Reuters", "category": "liquidity", "sentiment_score": -0.78}',
    false,
    null,
    'none',
    false,
    'cfab84c3-2a44-4c60-97a1-c0dbe50d1015',
    now() - interval '4 hours'
  ),
  (
    'e0000001-0000-0000-0000-000000000007',
    'customer',
    'c0000001-0000-0000-0000-000000000029',
    'NEGATIVE_NEWS_HIGH',
    'news_monitor_agent',
    'high',
    'NEGATIVE_NEWS',
    'Arconic Corporation: Credit downgrade warning',
    'Rating agency places Arconic on negative watch citing high leverage and slowing demand.',
    '{"headline": "Arconic placed on negative watch by Moody s", "source": "Bloomberg", "category": "credit_rating", "sentiment_score": -0.65}',
    false,
    null,
    'none',
    false,
    'cfab84c3-2a44-4c60-97a1-c0dbe50d1015',
    now() - interval '5 hours'
  )
ON CONFLICT (id) DO NOTHING;
