ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS currency_amount numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS booking_fx_rate numeric;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS fx_hedged boolean NOT NULL DEFAULT false;

CREATE TABLE public.fx_rate_history (
  currency text NOT NULL CHECK (char_length(currency) = 3),
  rate_date date NOT NULL,
  rate numeric NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'fmp',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, rate_date)
);

CREATE TABLE public.fx_currency_status (
  currency text PRIMARY KEY CHECK (char_length(currency) = 3),
  rate numeric NOT NULL,
  rate_date date NOT NULL,
  change_5d_pct numeric,
  change_30d_pct numeric,
  volatility_pct numeric,
  source text NOT NULL DEFAULT 'fmp',
  as_of timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.seed_fx_rates (
  currency text NOT NULL CHECK (char_length(currency) = 3),
  days_ago integer NOT NULL CHECK (days_ago >= 0),
  rate numeric NOT NULL CHECK (rate > 0),
  PRIMARY KEY (currency, days_ago)
);

ALTER TABLE public.fx_rate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_currency_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seed_fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY fx_rate_history_read ON public.fx_rate_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY fx_currency_status_read ON public.fx_currency_status FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.seed_fx_rates (currency, days_ago, rate)
SELECT 'EUR', k,
  round((CASE WHEN k <= 30 THEN 0.9575 - 0.0375 * k / 30.0 ELSE 0.92 + 0.004 * sin(k / 6.0) END + 0.0015 * sin(1.7 * k))::numeric, 6)
FROM generate_series(0, 180) AS k
UNION ALL
SELECT 'JPY', k,
  round((CASE WHEN k <= 30 THEN 147 + 5.0 * k / 30.0 ELSE 152 + 1.2 * sin(k / 7.0) END + 0.4 * sin(2.3 * k))::numeric, 4)
FROM generate_series(0, 180) AS k
UNION ALL
SELECT 'GBP', k,
  round((0.78 + 0.004 * sin(k / 9.0) + 0.001 * sin(1.9 * k))::numeric, 6)
FROM generate_series(0, 180) AS k
ON CONFLICT (currency, days_ago) DO NOTHING;

CREATE OR REPLACE VIEW public.v_fx_exposure_by_invoice AS
WITH latest AS (
  SELECT DISTINCT ON (currency) currency, rate AS rate_now, rate_date AS rate_now_date
  FROM public.fx_rate_history
  ORDER BY currency, rate_date DESC
),
base AS (
  SELECT
    i.id AS invoice_id,
    i.customer_id,
    c.company_name,
    c.country_code,
    i.invoice_number,
    upper(i.currency) AS currency,
    coalesce(i.invoice_date, i.due_date - c.payment_terms_days) AS invoice_date,
    i.due_date,
    i.invoice_amount,
    i.outstanding_amount,
    i.currency_amount,
    i.fx_hedged,
    i.is_demo,
    c.payment_avg_days_early_late,
    l.rate_now,
    l.rate_now_date,
    coalesce(
      i.booking_fx_rate,
      (SELECT h.rate FROM public.fx_rate_history h
        WHERE h.currency = upper(i.currency)
          AND h.rate_date <= coalesce(i.invoice_date, i.due_date - c.payment_terms_days)
        ORDER BY h.rate_date DESC LIMIT 1),
      (SELECT h.rate FROM public.fx_rate_history h
        WHERE h.currency = upper(i.currency)
        ORDER BY h.rate_date ASC LIMIT 1)
    ) AS booking_rate
  FROM public.invoices i
  JOIN public.customers c ON c.id = i.customer_id
  JOIN latest l ON l.currency = upper(i.currency)
  WHERE upper(i.currency) <> 'USD'
    AND i.outstanding_amount > 0
),
calc AS (
  SELECT b.*,
    CASE
      WHEN b.currency_amount IS NOT NULL AND b.invoice_amount > 0
        THEN b.currency_amount * b.outstanding_amount / b.invoice_amount
      ELSE b.outstanding_amount * b.booking_rate
    END AS native_outstanding
  FROM base b
)
SELECT
  invoice_id,
  customer_id,
  company_name,
  country_code,
  invoice_number,
  currency,
  invoice_date,
  due_date,
  fx_hedged,
  is_demo,
  booking_rate,
  rate_now,
  rate_now_date,
  native_outstanding,
  outstanding_amount::numeric AS usd_at_booking,
  native_outstanding / rate_now AS usd_now,
  native_outstanding / rate_now - outstanding_amount AS fx_delta_usd,
  (booking_rate / rate_now - 1) * 100 AS usd_value_change_pct,
  (due_date + round(coalesce(payment_avg_days_early_late, 0))::int) AS expected_pay_date,
  ((due_date + round(coalesce(payment_avg_days_early_late, 0))::int) - invoice_date) AS window_days,
  ((due_date + round(coalesce(payment_avg_days_early_late, 0))::int) - CURRENT_DATE) AS days_to_expected_pay,
  (native_outstanding / rate_now) * 0.10 AS sensitivity_10pct_usd
FROM calc;

GRANT SELECT ON public.v_fx_exposure_by_invoice TO anon, authenticated;

UPDATE public.invoices SET fx_hedged = true
WHERE invoice_number IN ('FX-BAYE-399B-001', 'FX-BAYE-399B-002');
