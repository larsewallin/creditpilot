-- Deterministic SEC filing seed data for demo mode.
--
-- The SEC agent's DEMO_MODE bypass (pre-baked log, no pipeline) is replaced by
-- fetchSeedSecFilings(), which reads from this table instead of hitting live
-- EDGAR. Demo and production then run the same pipeline; the only difference is
-- the input source.
--
-- Seed rows use real EDGAR accession numbers and document URLs so the data is
-- verifiable. risk_signals are pre-computed (matching RISK_KEYWORDS in
-- fetch-sec-filing.ts) so the real event-routing logic fires correctly:
--   Heliogen row  → going_concern_warning + cash_runway_<3_quarters → GOING_CONCERN (critical)
--   Triumph row   → covenant_waiver                                 → SEC_OTHER/covenant_waiver (high)

CREATE TABLE IF NOT EXISTS seed_sec_filings (
  id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  cik              text        NOT NULL,
  company_name     text        NOT NULL,
  filing_type      text        NOT NULL,
  filing_date      date        NOT NULL,
  accession_number text        NOT NULL,
  document_url     text        NOT NULL,
  risk_signals     text[]      NOT NULL DEFAULT '{}',
  key_findings     text        NOT NULL DEFAULT '',
  provider         text        NOT NULL DEFAULT 'edgar',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seed_sec_filings_cik_idx ON seed_sec_filings(cik);

INSERT INTO seed_sec_filings
  (cik, company_name, filing_type, filing_date, accession_number, document_url, risk_signals, key_findings)
VALUES
  (
    '0001840292',
    'Heliogen, Inc.',
    '10-K',
    '2025-03-27',
    '0001840292-25-000012',
    'https://www.sec.gov/Archives/edgar/data/1840292/000184029225000012/hlg-20241231.htm',
    ARRAY['going_concern_warning', 'cash_runway_<3_quarters'],
    'Auditor expressed substantial doubt about the company''s ability to continue as a going concern; cash runway under three quarters.'
  ),
  (
    '0001021162',
    'Triumph Group, Inc.',
    '10-Q',
    '2025-02-06',
    '0000950170-25-015468',
    'https://www.sec.gov/Archives/edgar/data/1021162/000095017025015468/tgi-20241231.htm',
    ARRAY['covenant_waiver'],
    'Company disclosed a covenant waiver under its credit agreement.'
  );
