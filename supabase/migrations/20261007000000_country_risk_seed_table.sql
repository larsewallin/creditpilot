-- Seed table for the Country Risk Monitor's DEMO_MODE path (mirrors the
-- seed_industry_* pattern). One row per country; "previous_*" columns let the
-- agent detect a change without a history table. Live mode will replace the
-- fetch point (stub for now); this table is never read outside DEMO_MODE.

CREATE TABLE public.seed_country_risk (
    country_code text PRIMARY KEY CHECK (char_length(country_code) = 2),
    country_name text NOT NULL,
    central_bank text NOT NULL,
    political_score integer NOT NULL CHECK (political_score BETWEEN 0 AND 100),
    previous_political_score integer NOT NULL CHECK (previous_political_score BETWEEN 0 AND 100),
    political_risk_type text NOT NULL DEFAULT 'other',
    political_summary text,
    economic_score integer NOT NULL CHECK (economic_score BETWEEN 0 AND 100),
    previous_economic_score integer NOT NULL CHECK (previous_economic_score BETWEEN 0 AND 100),
    economic_shock_type text NOT NULL DEFAULT 'other',
    economic_summary text,
    rating_agency text NOT NULL DEFAULT 'sp',
    previous_rating text NOT NULL,
    current_rating text NOT NULL,
    rating_outlook text NOT NULL DEFAULT 'stable',
    rating_effective_date date NOT NULL,
    policy_rate numeric NOT NULL,
    previous_policy_rate numeric NOT NULL,
    rate_effective_date date NOT NULL,
    tariff_change_percent numeric,
    tariff_affected_countries text[],
    tariff_affected_sectors text[],
    tariff_effective_date date,
    tariff_summary text,
    evidence_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO seed_country_risk
 (country_code, country_name, central_bank, political_score, previous_political_score, political_risk_type, political_summary,
  economic_score, previous_economic_score, economic_shock_type, economic_summary,
  rating_agency, previous_rating, current_rating, rating_outlook, rating_effective_date,
  policy_rate, previous_policy_rate, rate_effective_date,
  tariff_change_percent, tariff_affected_countries, tariff_affected_sectors, tariff_effective_date, tariff_summary, evidence_url)
VALUES
 ('US','United States','Federal Reserve',78,78,'other',NULL,80,80,'other',NULL,'sp','AA+','AA+','stable','2025-08-01',4.25,4.25,'2026-09-17',
   12.0,ARRAY['CN','MX'],ARRAY['Materials','Industrial Manufacturing'],'2026-10-15','New 12% tariff on imported industrial inputs from China and Mexico takes effect mid-October.','https://example.com/country/us'),
 ('DE','Germany','European Central Bank',82,82,'other',NULL,70,70,'other',NULL,'sp','AAA','AA+','negative','2026-09-25',2.00,2.00,'2026-07-24',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/de'),
 ('JP','Japan','Bank of Japan',80,80,'other',NULL,68,68,'other',NULL,'sp','A+','A+','stable','2025-08-01',0.75,0.25,'2026-09-19',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/jp'),
 ('GB','United Kingdom','Bank of England',74,74,'other',NULL,66,66,'other',NULL,'sp','AA','AA','stable','2025-08-01',4.00,4.00,'2026-08-07',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/gb'),
 ('FR','France','European Central Bank',64,64,'other',NULL,62,62,'other',NULL,'fitch','A+','A+','stable','2025-09-12',2.00,2.00,'2026-07-24',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/fr'),
 ('CN','China','People''s Bank of China',45,45,'other',NULL,58,58,'other',NULL,'sp','A+','A+','stable','2025-08-01',3.00,3.00,'2026-05-20',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/cn'),
 ('BR','Brazil','Banco Central do Brasil',48,62,'election','Contested election campaign and fiscal-policy uncertainty are weighing on investor confidence.',50,50,'other',NULL,'sp','BB','BB','stable','2025-08-01',14.25,14.25,'2026-09-18',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/br'),
 ('MX','Mexico','Banco de Mexico',52,52,'other',NULL,55,55,'other',NULL,'moodys','Baa2','Baa2','stable','2025-08-01',7.00,7.00,'2026-09-25',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/mx'),
 ('IN','India','Reserve Bank of India',60,60,'other',NULL,65,65,'other',NULL,'sp','BBB-','BBB','positive','2026-08-14',5.50,5.50,'2026-08-06',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/in'),
 ('TR','Turkey','Central Bank of Turkey',35,35,'other',NULL,22,48,'currency_crisis','Sharp lira depreciation and falling reserves are straining external payments.',
   'sp','B+','B+','negative','2025-08-01',40.00,40.00,'2026-09-11',
   NULL,NULL,NULL,NULL,NULL,'https://example.com/country/tr');

ALTER TABLE public.seed_country_risk ENABLE ROW LEVEL SECURITY;
