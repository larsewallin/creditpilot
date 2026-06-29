-- Seed fixed rows for negative_news and sec_monitoring.
-- Fixed UUIDs allow initDemo() to reliably upsert these back to seed state on reset.

INSERT INTO public.negative_news (id, customer_id, headline, summary, source, news_date, category, severity, sentiment_score, reviewed, agent_name)
VALUES
  (
    'e0000001-0000-0000-0000-000000000001',
    'c0000001-0000-0000-0000-000000000049',  -- Heliogen Inc
    'Heliogen liquidity concerns mount as runway shrinks',
    'Analyst report cites deteriorating cash position and risk of covenant breach in Q3.',
    'Reuters',
    '2026-04-19',
    'liquidity',
    'high',
    -0.78,
    false,
    'news_monitor_agent'
  ),
  (
    'e0000001-0000-0000-0000-000000000002',
    'c0000001-0000-0000-0000-000000000029',  -- Arconic Corporation
    'Arconic placed on negative watch by Moody''s',
    'Rating agency places Arconic on negative watch citing high leverage and slowing demand.',
    'Bloomberg',
    '2026-04-19',
    'credit_rating',
    'high',
    -0.65,
    false,
    'news_monitor_agent'
  )
ON CONFLICT (id) DO NOTHING;

-- sec_monitoring: seed rows for the two demo-monitored customers.
-- ON CONFLICT (customer_id) preserves existing rows (ai_risk_score / ai_summary).
INSERT INTO public.sec_monitoring (id, customer_id, cik, alert_triggered)
VALUES
  (
    'f0000001-0000-0000-0000-000000000001',
    'c0000001-0000-0000-0000-000000000021',  -- Triumph Group
    '1021162',
    true
  ),
  (
    'f0000001-0000-0000-0000-000000000002',
    'c0000001-0000-0000-0000-000000000049',  -- Heliogen Inc
    '1840292',
    true
  )
ON CONFLICT (customer_id) DO NOTHING;
