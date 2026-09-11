-- Layer 1 field alignment: add columns that skills return but tables were missing.
-- Identified by field-by-field audit of skill interfaces vs table schemas.

-- sec_filings: add cik and provider for full audit trail
ALTER TABLE public.sec_filings
  ADD COLUMN IF NOT EXISTS cik      text,
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'edgar';

-- negative_news: add relevance_score for future sorting/filtering
ALTER TABLE public.negative_news
  ADD COLUMN IF NOT EXISTS relevance_score numeric;

-- invoices: add currency (silently dropped from CSV upload — always coerced to USD)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';
