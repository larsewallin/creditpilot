
-- ============================================================
-- CREDIT AGENT OBSERVER — FULL SCHEMA (fixed)
-- ============================================================

CREATE TABLE public.company (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.company(id),
  company_name text NOT NULL,
  ticker text,
  industry text,
  scenario text DEFAULT 'normal_operations',
  credit_limit numeric DEFAULT 0,
  current_exposure numeric DEFAULT 0,
  payment_terms_days integer DEFAULT 30,
  account_manager text,
  notes text,
  flags text[] DEFAULT '{}',
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  invoice_number text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  outstanding_amount numeric DEFAULT 0,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  days_overdue integer DEFAULT 0,
  status text DEFAULT 'open',
  dunning_level integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id),
  payment_date date NOT NULL,
  amount numeric NOT NULL,
  payment_method text DEFAULT 'wire',
  days_to_pay integer,
  days_early_late integer,
  on_time boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL UNIQUE,
  credit_score integer,
  altman_z_score numeric,
  d_and_b_rating text,
  current_ratio numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ar_aging_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  current_amount numeric DEFAULT 0,
  days_1_30 numeric DEFAULT 0,
  days_31_60 numeric DEFAULT 0,
  days_61_90 numeric DEFAULT 0,
  days_over_90 numeric DEFAULT 0,
  total_ar numeric DEFAULT 0,
  credit_limit numeric DEFAULT 0,
  utilization_pct numeric DEFAULT 0,
  dso numeric DEFAULT 0,
  risk_tier text DEFAULT 'CURRENT',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.negative_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  headline text NOT NULL,
  summary text,
  source text,
  news_date date NOT NULL DEFAULT CURRENT_DATE,
  category text,
  severity text DEFAULT 'medium',
  sentiment_score numeric DEFAULT 0,
  reviewed boolean DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  agent_name text DEFAULT 'news_monitor_agent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credit_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  action_type text NOT NULL,
  description text,
  agent_name text,
  action_date date DEFAULT CURRENT_DATE,
  status text DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sec_monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  cik text,
  last_10k_date date,
  last_10q_date date,
  risk_signals text[] DEFAULT '{}',
  alert_triggered boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sec_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  filing_type text NOT NULL,
  filing_date date NOT NULL,
  key_findings text,
  risk_signals text[] DEFAULT '{}',
  reviewed boolean DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  agent_name text DEFAULT 'sec_monitor_agent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.bankruptcy_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  filing_date date,
  chapter text,
  status text,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.growth_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) NOT NULL,
  signal_type text NOT NULL,
  description text,
  detected_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW public.v_ar_aging_current AS
SELECT DISTINCT ON (a.customer_id)
  a.*,
  c.company_name,
  c.ticker
FROM public.ar_aging_snapshots a
JOIN public.customers c ON c.id = a.customer_id
ORDER BY a.customer_id, a.as_of_date DESC;

CREATE OR REPLACE VIEW public.v_ar_aging_portfolio AS
SELECT
  COALESCE(SUM(current_amount), 0) as total_current,
  COALESCE(SUM(days_1_30), 0) as total_1_30,
  COALESCE(SUM(days_31_60), 0) as total_31_60,
  COALESCE(SUM(days_61_90), 0) as total_61_90,
  COALESCE(SUM(days_over_90), 0) as total_over_90,
  COALESCE(SUM(total_ar), 0) as total_ar,
  COUNT(*) as customer_count
FROM public.v_ar_aging_current;

CREATE OR REPLACE VIEW public.v_overdue_invoices AS
SELECT
  i.*,
  c.company_name,
  c.ticker
FROM public.invoices i
JOIN public.customers c ON c.id = i.customer_id
WHERE i.due_date < CURRENT_DATE AND i.status != 'paid';

CREATE OR REPLACE VIEW public.v_payment_behaviour AS
SELECT
  pt.customer_id,
  c.company_name,
  c.ticker,
  ROUND(AVG(pt.days_to_pay)::numeric, 0) as avg_days_to_pay,
  ROUND(COUNT(*) FILTER (WHERE pt.on_time) * 100.0 / NULLIF(COUNT(*), 0), 1) as on_time_pct,
  COUNT(*) as total_payments
FROM public.payment_transactions pt
JOIN public.customers c ON c.id = pt.customer_id
GROUP BY pt.customer_id, c.company_name, c.ticker;

CREATE OR REPLACE VIEW public.v_customers_at_risk AS
SELECT c.*, cm.credit_score, cm.altman_z_score
FROM public.customers c
LEFT JOIN public.credit_metrics cm ON cm.customer_id = c.id
WHERE c.scenario IN ('credit_deterioration', 'bankruptcy', 'payment_issues');

CREATE OR REPLACE VIEW public.v_sec_monitoring_dashboard AS
SELECT
  sm.*,
  c.company_name,
  c.ticker
FROM public.sec_monitoring sm
JOIN public.customers c ON c.id = sm.customer_id;

-- ============================================================
-- FUNCTION: Refresh AR Aging
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_refresh_all_ar_aging(p_as_of date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cust RECORD;
BEGIN
  FOR cust IN SELECT id, credit_limit FROM public.customers LOOP
    INSERT INTO public.ar_aging_snapshots (
      customer_id, as_of_date, current_amount, days_1_30, days_31_60, days_61_90, days_over_90,
      total_ar, credit_limit, utilization_pct, dso, risk_tier
    )
    SELECT
      cust.id,
      p_as_of,
      COALESCE(SUM(CASE WHEN i.days_overdue = 0 THEN i.outstanding_amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN i.days_overdue BETWEEN 1 AND 30 THEN i.outstanding_amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN i.days_overdue BETWEEN 31 AND 60 THEN i.outstanding_amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN i.days_overdue BETWEEN 61 AND 90 THEN i.outstanding_amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN i.days_overdue > 90 THEN i.outstanding_amount ELSE 0 END), 0),
      COALESCE(SUM(i.outstanding_amount), 0),
      cust.credit_limit,
      CASE WHEN cust.credit_limit > 0
        THEN ROUND(COALESCE(SUM(i.outstanding_amount), 0) * 100.0 / cust.credit_limit, 1)
        ELSE 0
      END,
      COALESCE(ROUND(AVG(i.days_overdue)::numeric, 0), 0),
      CASE
        WHEN COALESCE(SUM(CASE WHEN i.days_overdue > 90 THEN i.outstanding_amount ELSE 0 END), 0) > 0 THEN 'CRITICAL'
        WHEN COALESCE(SUM(CASE WHEN i.days_overdue > 60 THEN i.outstanding_amount ELSE 0 END), 0) > 0 THEN 'HIGH'
        WHEN COALESCE(SUM(CASE WHEN i.days_overdue > 30 THEN i.outstanding_amount ELSE 0 END), 0) > 0 THEN 'MEDIUM'
        WHEN COALESCE(SUM(CASE WHEN i.days_overdue > 0 THEN i.outstanding_amount ELSE 0 END), 0) > 0 THEN 'LOW'
        ELSE 'CURRENT'
      END
    FROM public.invoices i
    WHERE i.customer_id = cust.id AND i.status != 'paid';
  END LOOP;
END;
$$;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.company ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_aging_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negative_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sec_monitoring ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sec_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bankruptcy_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON public.company FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.invoices FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.payment_transactions FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.credit_metrics FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.ar_aging_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.negative_news FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.credit_actions FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.sec_monitoring FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.sec_filings FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.bankruptcy_details FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.growth_signals FOR SELECT USING (true);

CREATE POLICY "Public write" ON public.negative_news FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public write" ON public.sec_filings FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public insert" ON public.ar_aging_snapshots FOR INSERT WITH CHECK (true);
