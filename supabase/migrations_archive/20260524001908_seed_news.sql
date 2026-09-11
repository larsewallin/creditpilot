-- Deterministic news seed data for demo mode.
--
-- Replaces the News agent's DEMO_MODE bypass. searchSeedNews() reads raw
-- (unclassified) articles from this table instead of hitting Tavily, so demo
-- runs the SAME pipeline as production: searchSeedNews -> classifyNews ->
-- publishEvent. Rows are raw articles (no severity/category) — classification
-- happens at runtime via classifyNews, exactly as in production.
--
-- Mirrors the RawArticle shape returned by searchNews (search-news.ts) plus
-- customer linkage. url is nullable: these demo customers are largely fictional
-- so no real article URLs exist; a null URL must never drop a real event.
--
-- Four rows, one per customer that currently has a demo news event, so the
-- regenerated demo reproduces the same companies. The resulting subcategory /
-- severity will be whatever classifyNews assigns at runtime (the real 8-value
-- category set), which may differ slightly run-to-run — that is genuine
-- pipeline behaviour, not a defect.

CREATE TABLE IF NOT EXISTS seed_news (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  company_name    text        NOT NULL,
  headline        text        NOT NULL,
  summary         text        NOT NULL,
  url             text,
  source          text        NOT NULL,
  published_date  date        NOT NULL,
  relevance_score numeric     NOT NULL DEFAULT 0.9,
  provider        text        NOT NULL DEFAULT 'manual',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seed_news_customer_id_idx ON seed_news(customer_id);

INSERT INTO seed_news
  (customer_id, company_name, headline, summary, url, source, published_date, relevance_score, provider)
VALUES
  (
    'c0000002-0000-0000-0000-000000000001',
    'Atlas Precision Manufacturing',
    'Atlas Precision cash flow under pressure amid supply chain disruption',
    'Atlas Precision Manufacturing is facing mounting working-capital strain as prolonged supply chain disruptions delay component deliveries and inflate input costs. Analysts note the company has drawn heavily on its revolving credit facility over the past two quarters.',
    NULL,
    'Reuters',
    '2026-04-28',
    0.91,
    'manual'
  ),
  (
    'c0000002-0000-0000-0000-000000000004',
    'Northgate Fabrication',
    'Northgate Fabrication faces insolvency risk as anchor customer exits contract',
    'Northgate Fabrication is reportedly at risk of insolvency after its largest customer terminated a multi-year supply contract. The loss is estimated to represent a substantial share of annual revenue, raising concerns about the company''s ability to service its obligations.',
    NULL,
    'Bloomberg',
    '2026-05-01',
    0.94,
    'manual'
  ),
  (
    'c0000001-0000-0000-0000-000000000049',
    'Heliogen Inc',
    'Heliogen liquidity concerns mount as cash runway shrinks',
    'Heliogen Inc is under growing scrutiny over its liquidity position, with analysts warning that its cash runway may fall below three quarters absent new financing. The company has not announced a capital raise despite repeated questions from investors.',
    NULL,
    'Reuters',
    '2026-04-22',
    0.89,
    'manual'
  ),
  (
    'c0000001-0000-0000-0000-000000000029',
    'Arconic Corporation',
    'Arconic placed on negative watch by Moody''s',
    'Moody''s has placed Arconic Corporation on negative watch, citing weakening margins and elevated leverage. A downgrade would raise the company''s borrowing costs and could trigger covenant pressure on existing facilities.',
    NULL,
    'Bloomberg',
    '2026-04-30',
    0.88,
    'manual'
  ),
  (
    'c0000001-0000-0000-0000-000000000021',
    'Triumph Group Inc',
    'Triumph Group draws covenant waiver as leverage strains balance sheet',
    'Triumph Group has secured a waiver from lenders after breaching financial covenants, according to people familiar with the matter. The aerospace supplier faces continued margin pressure and elevated leverage, raising questions about its near-term liquidity.',
    NULL,
    'Reuters',
    '2026-05-02',
    0.92,
    'manual'
  );
