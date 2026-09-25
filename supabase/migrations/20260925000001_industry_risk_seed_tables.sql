-- Seed tables for the Industry Risk Monitor's DEMO_MODE path, mirroring the
-- seed_news / seed_sec_filings pattern: demo mode reads these instead of
-- hitting live FRED/BLS/GDELT, so the real agent pipeline runs
-- deterministically without external calls or API keys.
--
-- Unlike seed_news/seed_sec_filings (keyed on customer_id/cik), these are
-- keyed on sector -- this agent is scope='industry', the first
-- industry-scoped emitter (SEC/News/AR/Payment Behaviour are all
-- scope='customer'). One sector's signal is relevant to every customer in
-- that sector, not one specific customer.

CREATE TABLE public.seed_industry_econ_signals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    sector text NOT NULL,
    indicator text NOT NULL,
    source_series text NOT NULL,
    observation_date date NOT NULL,
    change_percent numeric NOT NULL,  -- raw, unsigned as the series itself reports it; sign normalization happens in the agent (Phase 3), not baked into seed data
    period_days integer DEFAULT 365 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.seed_industry_news (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL PRIMARY KEY,
    sector text NOT NULL,
    headline text NOT NULL,
    summary text NOT NULL,
    url text,
    source text NOT NULL,
    published_date date NOT NULL,
    disruption_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ── Econ signals ─────────────────────────────────────────────────────────────
-- Deliberately includes the same raw oil-price move (-22%) affecting Energy
-- (producer) and Transportation (consumer) oppositely, and the same raw
-- steel-price move (+18%) affecting Materials (producer) and Industrial
-- Manufacturing (consumer) oppositely -- a direct, reviewable demonstration
-- that Phase 3's sign normalization is wired correctly end to end.

INSERT INTO seed_industry_econ_signals (sector, indicator, source_series, observation_date, change_percent, period_days) VALUES
  ('Energy',                   'commodity_price',   'FRED:DCOILWTICO',    '2026-09-01', -22.0, 365),
  ('Transportation',           'commodity_price',   'FRED:DCOILWTICO',    '2026-09-01', -22.0, 365),
  ('Materials',                'commodity_price',   'FRED:WPU101',        '2026-09-01',  18.0, 365),
  ('Industrial Manufacturing', 'commodity_price',   'FRED:WPU101',        '2026-09-01',  18.0, 365),
  ('Aerospace & Defense',      'production_output',  'FRED:IPG3364S',      '2026-09-01',  -8.5, 365),
  ('Mining',                   'production_output',  'FRED:IPG212S',       '2026-09-01', -12.3, 365),
  ('Energy',                   'production_output',  'FRED:IPG211S',       '2026-09-01',   2.1, 365);

-- ── News/disruption signals ──────────────────────────────────────────────────

INSERT INTO seed_industry_news (sector, headline, summary, url, source, published_date, disruption_type) VALUES
  ('Aerospace & Defense', 'New export controls tighten aerospace component shipments',
   'Expanded export licensing requirements on precision-machined aerospace components are delaying international deliveries and raising compliance costs across the sector.',
   'https://example.com/news/aerospace-export-controls', 'Reuters', '2026-08-28', 'geopolitical'),

  ('Energy', 'Regulators propose new offshore drilling permit requirements',
   'A proposed rule would add environmental review steps to offshore drilling permits, extending typical approval timelines by several months.',
   'https://example.com/news/energy-drilling-permits', 'Bloomberg', '2026-08-30', 'regulatory'),

  ('Industrial Manufacturing', 'Semiconductor shortage resurfaces for industrial control systems',
   'A renewed shortage of specialty semiconductors used in industrial control systems is extending lead times for manufacturers across the sector.',
   'https://example.com/news/manufacturing-chip-shortage', 'Reuters', '2026-09-02', 'supply_chain'),

  ('Materials', 'Steelworkers union authorizes strike vote at major mills',
   'A strike authorization vote covering several major steel mills raises the risk of a production disruption if contract negotiations fail.',
   'https://example.com/news/materials-steel-strike', 'Wall Street Journal', '2026-09-05', 'labor'),

  ('Mining', 'Flooding forces temporary closure of major ore mining operations',
   'Severe flooding has forced the temporary shutdown of several ore mining operations, with full resumption not expected for weeks.',
   'https://example.com/news/mining-flooding', 'Associated Press', '2026-09-03', 'natural_disaster'),

  ('Transportation', 'Port labor negotiations stall, raising strike risk',
   'Contract negotiations between dockworkers and port operators have stalled, raising the risk of a work stoppage affecting freight movement.',
   'https://example.com/news/transportation-port-labor', 'Reuters', '2026-09-06', 'labor');
