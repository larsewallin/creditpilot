-- Add upload tracking columns to invoices table
-- Allows freshness tracking and is_demo separation for CSV-uploaded invoices

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS uploaded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS upload_source text,
  ADD COLUMN IF NOT EXISTS is_demo      boolean NOT NULL DEFAULT false;

-- Performance index: agent queries filter by customer + open status
CREATE INDEX IF NOT EXISTS idx_invoices_customer_status
  ON public.invoices (customer_id, status);

-- Freshness index: find stale uploads per customer
CREATE INDEX IF NOT EXISTS idx_invoices_customer_uploaded
  ON public.invoices (customer_id, uploaded_at);
