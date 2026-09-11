-- Add document_url to sec_filings (agent now stores the filing landing URL)
ALTER TABLE public.sec_filings
  ADD COLUMN IF NOT EXISTS document_url text;

-- Replace per-customer accession dedup index with a global one.
-- EDGAR accession numbers are globally unique across all filers, so a
-- global unique index is stricter and prevents double-processing regardless
-- of how customer_id is assigned.
DROP INDEX IF EXISTS public.sec_filings_accession_customer_idx;

CREATE UNIQUE INDEX IF NOT EXISTS sec_filings_accession_idx
  ON public.sec_filings (accession_number)
  WHERE accession_number IS NOT NULL;
