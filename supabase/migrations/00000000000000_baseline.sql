--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: bankruptcy_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.bankruptcy_status AS ENUM (
    'FILED',
    'CONFIRMED_PLAN',
    'CHAPTER_7_CONVERTED',
    'ASSETS_SOLD',
    'EMERGED',
    'DISMISSED'
);


--
-- Name: credit_action_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_action_type AS ENUM (
    'PLACED_ON_WATCH_LIST',
    'REMOVED_FROM_WATCH_LIST',
    'CREDIT_HOLD_PLACED',
    'CREDIT_HOLD_RELEASED',
    'CREDIT_LIMIT_REDUCTION',
    'CREDIT_LIMIT_INCREASE',
    'CREDIT_LIMIT_REVIEW',
    'DUNNING_LETTER_STAGE_1',
    'DUNNING_LETTER_STAGE_2',
    'DUNNING_LETTER_STAGE_3',
    'DUNNING_LETTER_STAGE_4',
    'REFERRED_TO_COLLECTIONS',
    'PROOF_OF_CLAIM_FILED',
    'COD_ONLY_POLICY_SET',
    'PARENT_GUARANTEE_REQUEST_SENT',
    'CREDIT_REVIEW_INITIATED',
    'LEGAL_COUNSEL_ENGAGED',
    'PAYMENT_PLAN_DISCUSSION',
    'PAYMENT_PLAN_AGREED',
    'SEC_ALERT_TRIGGERED',
    'NEWS_ALERT_TRIGGERED',
    'NEWS_MONITORING_INCREASED',
    'FINANCIALS_REQUEST_SENT',
    'EXECUTIVE_ESCALATION',
    'OTHER'
);


--
-- Name: credit_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_event_type AS ENUM (
    'RATING_DOWNGRADE',
    'RATING_UPGRADE',
    'OUTLOOK_CHANGE',
    'EARNINGS_MISS',
    'EARNINGS_BEAT',
    'COVENANT_WAIVER',
    'COVENANT_BREACH',
    'RESTRUCTURING_ANNOUNCEMENT',
    'MANAGEMENT_CHANGE',
    'OWNERSHIP_CHANGE',
    'SEC_INVESTIGATION',
    'GOODWILL_IMPAIRMENT',
    'CAPITAL_RAISE',
    'LOAN_AMENDMENT',
    'CONTRACT_LOSS',
    'CONTRACT_WIN',
    'GOING_CONCERN',
    'CREDIT_FACILITY_AMENDMENT',
    'OTHER'
);


--
-- Name: dunning_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.dunning_stage AS ENUM (
    '1',
    '2',
    '3',
    '4'
);


--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'current',
    'overdue',
    'pre_petition',
    'paid',
    'written_off',
    'disputed',
    'open'
);


--
-- Name: market_cap_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.market_cap_tier AS ENUM (
    'large_cap',
    'mid_cap',
    'small_cap',
    'private',
    'private_subsidiary'
);


--
-- Name: payment_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_method AS ENUM (
    'wire_transfer',
    'ach',
    'check',
    'credit_card',
    'offset',
    'partial',
    'other',
    'wire'
);


--
-- Name: scenario_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.scenario_type AS ENUM (
    'normal_operations',
    'payment_issues',
    'credit_deterioration',
    'negative_news',
    'bankruptcy',
    'growth_opportunity',
    'sec_filing_monitoring'
);


--
-- Name: fn_rank_portfolio_risk(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_rank_portfolio_risk() RETURNS TABLE(id uuid, company_name text, company_type text, credit_limit bigint, current_exposure bigint, credit_rating_score integer, credit_rating_raw text, credit_rating_source text, scenario public.scenario_type, risk_tags text[], payment_on_time_rate numeric, payment_trend text, payment_health text, is_high_risk boolean, recent_severity_sum bigint, latest_event_date timestamp with time zone)
    LANGUAGE sql STABLE
    SET search_path = public, extensions
    AS $$
  WITH latest_snap AS (
    SELECT DISTINCT ON (customer_id) customer_id, pre_petition_amount
    FROM ar_aging_snapshots ORDER BY customer_id, snapshot_date DESC
  ),
  going_concern AS (
    SELECT DISTINCT customer_id FROM credit_events WHERE event_type = 'GOING_CONCERN'
  ),
  sev AS (
    SELECT customer_id,
           COALESCE(SUM(severity_score),0)::bigint AS recent_severity_sum,
           MAX(created_at) AS latest_event_date
    FROM credit_events
    WHERE created_at >= now() - interval '90 days'
    GROUP BY customer_id
  ),
  evt_any AS (
    SELECT customer_id, MAX(created_at) AS latest_event_date_all
    FROM credit_events GROUP BY customer_id
  )
  SELECT
    c.id, c.company_name, c.company_type,
    c.credit_limit, c.current_exposure, c.credit_rating_score,
    c.credit_rating_raw, c.credit_rating_source, c.scenario,
    c.risk_tags, c.payment_on_time_rate, c.payment_trend, c.payment_health,
    (
      c.current_exposure > 0 AND (
        c.credit_rating_score < 30
        OR c.scenario = 'bankruptcy'
        OR 'BANKRUPTCY' = ANY(c.risk_tags)
        OR gc.customer_id IS NOT NULL
        OR COALESCE(ls.pre_petition_amount,0) > 0
      )
    ) AS is_high_risk,
    COALESCE(sev.recent_severity_sum,0) AS recent_severity_sum,
    COALESCE(sev.latest_event_date, ea.latest_event_date_all) AS latest_event_date
  FROM customers c
  LEFT JOIN latest_snap ls ON ls.customer_id = c.id
  LEFT JOIN going_concern gc ON gc.customer_id = c.id
  LEFT JOIN sev ON sev.customer_id = c.id
  LEFT JOIN evt_any ea ON ea.customer_id = c.id
  ORDER BY
    (
      c.current_exposure > 0 AND (
        c.credit_rating_score < 30
        OR c.scenario = 'bankruptcy'
        OR 'BANKRUPTCY' = ANY(c.risk_tags)
        OR gc.customer_id IS NOT NULL
        OR COALESCE(ls.pre_petition_amount,0) > 0
      )
    ) DESC,
    c.current_exposure DESC,
    COALESCE(sev.recent_severity_sum,0) DESC,
    COALESCE(sev.latest_event_date, ea.latest_event_date_all) DESC NULLS LAST,
    c.company_name
  LIMIT 25;
$$;


--
-- Name: fn_recalculate_exposure(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recalculate_exposure(p_customer_id uuid) RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
BEGIN
  UPDATE customers SET
    current_exposure = (
      SELECT COALESCE(SUM(amount_outstanding), 0)
      FROM invoices
      WHERE customer_id = p_customer_id
        AND status NOT IN ('paid', 'written_off')
    ),
    updated_at = now()
  WHERE id = p_customer_id;
END;
$$;


--
-- Name: fn_refresh_all_ar_aging(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_refresh_all_ar_aging(p_as_of date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
DECLARE v_n INT := 0; v_id UUID;
BEGIN
  FOR v_id IN SELECT id FROM customers LOOP
    PERFORM public.fn_refresh_ar_aging(v_id, p_as_of);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;


--
-- Name: fn_refresh_ar_aging(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_refresh_ar_aging(p_customer_id uuid, p_as_of date DEFAULT CURRENT_DATE) RETURNS void
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
DECLARE
  v_cur BIGINT; v_b1  BIGINT; v_b2 BIGINT; v_b3 BIGINT; v_b4 BIGINT; v_pp BIGINT;
  v_cc  INT;    v_c1  INT;    v_c2 INT;    v_c3 INT;    v_c4 INT;
  v_lim BIGINT; v_util NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(amount_outstanding) FILTER (WHERE (p_as_of - due_date) <= 0 AND status = 'current'), 0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE (p_as_of - due_date) BETWEEN 1  AND 30 AND status != 'pre_petition'),  0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE (p_as_of - due_date) BETWEEN 31 AND 60 AND status != 'pre_petition'),  0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE (p_as_of - due_date) BETWEEN 61 AND 90 AND status != 'pre_petition'),  0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE (p_as_of - due_date) > 90 AND status != 'pre_petition'), 0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE status = 'pre_petition'), 0),
    COUNT(*) FILTER (WHERE (p_as_of - due_date) <= 0  AND status = 'current'),
    COUNT(*) FILTER (WHERE (p_as_of - due_date) BETWEEN 1  AND 30 AND status != 'pre_petition'),
    COUNT(*) FILTER (WHERE (p_as_of - due_date) BETWEEN 31 AND 60 AND status != 'pre_petition'),
    COUNT(*) FILTER (WHERE (p_as_of - due_date) BETWEEN 61 AND 90 AND status != 'pre_petition'),
    COUNT(*) FILTER (WHERE (p_as_of - due_date) > 90 AND status != 'pre_petition')
  INTO v_cur, v_b1, v_b2, v_b3, v_b4, v_pp,
       v_cc, v_c1, v_c2, v_c3, v_c4
  FROM invoices
  WHERE customer_id = p_customer_id AND status NOT IN ('paid','written_off');

  SELECT credit_limit INTO v_lim FROM customers WHERE id = p_customer_id;
  v_util := CASE WHEN v_lim > 0
    THEN ROUND(((v_cur+v_b1+v_b2+v_b3+v_b4+v_pp)::NUMERIC / v_lim)*100, 2)
    ELSE NULL END;

  INSERT INTO ar_aging_snapshots (
    customer_id, snapshot_date,
    current_amount, bucket_1_30, bucket_31_60, bucket_61_90, bucket_over_90,
    current_count, bucket_1_30_count, bucket_31_60_count, bucket_61_90_count, bucket_over_90_count,
    pre_petition_amount, credit_limit, utilization_pct
  ) VALUES (
    p_customer_id, p_as_of,
    v_cur, v_b1, v_b2, v_b3, v_b4,
    v_cc, v_c1, v_c2, v_c3, v_c4,
    v_pp, v_lim, v_util
  )
  ON CONFLICT (customer_id, snapshot_date) DO UPDATE SET
    current_amount      = EXCLUDED.current_amount,
    bucket_1_30         = EXCLUDED.bucket_1_30,
    bucket_31_60        = EXCLUDED.bucket_31_60,
    bucket_61_90        = EXCLUDED.bucket_61_90,
    bucket_over_90      = EXCLUDED.bucket_over_90,
    current_count       = EXCLUDED.current_count,
    bucket_1_30_count   = EXCLUDED.bucket_1_30_count,
    bucket_31_60_count  = EXCLUDED.bucket_31_60_count,
    bucket_61_90_count  = EXCLUDED.bucket_61_90_count,
    bucket_over_90_count= EXCLUDED.bucket_over_90_count,
    pre_petition_amount = EXCLUDED.pre_petition_amount,
    credit_limit        = EXCLUDED.credit_limit,
    utilization_pct     = EXCLUDED.utilization_pct;
END;
$$;


--
-- Name: fn_trg_recalculate_exposure(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_trg_recalculate_exposure() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
BEGIN
  PERFORM public.fn_recalculate_exposure(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.customer_id ELSE NEW.customer_id END
  );
  RETURN NULL;
END;
$$;


--
-- Name: fn_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, extensions
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    agent_name text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    template_type text NOT NULL,
    recipient_type text DEFAULT 'customer'::text NOT NULL,
    recipient_name text,
    recipient_email text,
    subject text,
    body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    delivered_via text,
    sent_at timestamp with time zone,
    invoice_ids uuid[],
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT agent_messages_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'teams'::text, 'internal'::text]))),
    CONSTRAINT agent_messages_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['customer'::text, 'account_manager'::text, 'credit_committee'::text]))),
    CONSTRAINT agent_messages_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'delivered'::text, 'failed'::text])))
);


--
-- Name: agent_processed_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_processed_events (
    agent_name text NOT NULL,
    event_id uuid NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE agent_processed_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.agent_processed_events IS 'V1 taxonomy: idempotency tracking. Consumers record (agent_name, event_id) after processing an event. Prevents duplicate processing on rerun.';


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    customers_scanned integer DEFAULT 0,
    conditions_found integer DEFAULT 0,
    messages_composed integer DEFAULT 0,
    actions_taken integer DEFAULT 0,
    summary text,
    error_message text,
    triggered_by text DEFAULT 'manual'::text,
    CONSTRAINT agent_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: ar_aging_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_aging_snapshots (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
    current_amount bigint DEFAULT 0 NOT NULL,
    bucket_1_30 bigint DEFAULT 0 NOT NULL,
    bucket_31_60 bigint DEFAULT 0 NOT NULL,
    bucket_61_90 bigint DEFAULT 0 NOT NULL,
    bucket_over_90 bigint DEFAULT 0 NOT NULL,
    total_outstanding bigint GENERATED ALWAYS AS (((((current_amount + bucket_1_30) + bucket_31_60) + bucket_61_90) + bucket_over_90)) STORED,
    current_count integer DEFAULT 0,
    bucket_1_30_count integer DEFAULT 0,
    bucket_31_60_count integer DEFAULT 0,
    bucket_61_90_count integer DEFAULT 0,
    bucket_over_90_count integer DEFAULT 0,
    total_invoice_count integer GENERATED ALWAYS AS (((((current_count + bucket_1_30_count) + bucket_31_60_count) + bucket_61_90_count) + bucket_over_90_count)) STORED,
    pre_petition_amount bigint DEFAULT 0 NOT NULL,
    credit_limit bigint,
    utilization_pct numeric(6,2),
    generated_by text DEFAULT 'system'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bankruptcy_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bankruptcy_details (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    filing_date date NOT NULL,
    case_number text NOT NULL,
    court text,
    chapter integer NOT NULL,
    status public.bankruptcy_status DEFAULT 'FILED'::public.bankruptcy_status NOT NULL,
    plan_confirmation_date date,
    emergence_date_estimated text,
    chapter7_conversion_date date,
    asset_sale_date date,
    asset_buyer text,
    trustee text,
    reorganization_advisor text,
    legal_counsel text,
    proof_of_claim_filed boolean DEFAULT false,
    proof_of_claim_date date,
    proof_of_claim_amount bigint,
    estimated_recovery_rate numeric(5,4),
    estimated_recovery_amount bigint,
    total_pre_petition_claim bigint,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bankruptcy_details_chapter_check CHECK ((chapter = ANY (ARRAY[7, 11, 13]))),
    CONSTRAINT bankruptcy_details_estimated_recovery_rate_check CHECK (((estimated_recovery_rate >= (0)::numeric) AND (estimated_recovery_rate <= (1)::numeric)))
);


--
-- Name: company; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    ticker text,
    industry text,
    annual_revenue bigint,
    description text,
    headquarters text,
    founded integer,
    employees integer,
    max_single_customer_exposure_pct numeric(5,2) DEFAULT 10.0,
    standard_payment_terms_days integer DEFAULT 45,
    review_trigger_days_overdue integer DEFAULT 30,
    watch_list_trigger_days_overdue integer DEFAULT 60,
    total_portfolio_limit bigint DEFAULT 130000000,
    base_currency text DEFAULT 'USD'::text,
    fiscal_year_end_month integer DEFAULT 12,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_actions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    action_date date NOT NULL,
    action_type public.credit_action_type NOT NULL,
    description text,
    old_limit bigint,
    new_limit bigint,
    claim_amount bigint,
    performed_by text,
    agent_name text,
    requires_review boolean DEFAULT false,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text DEFAULT 'customer'::text NOT NULL,
    customer_id uuid,
    customer_ids uuid[],
    event_type text NOT NULL,
    source_agent text NOT NULL,
    severity text NOT NULL,
    signal_type text,
    title text NOT NULL,
    description text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    previous_value numeric,
    new_value numeric,
    value_type text,
    credit_rating_score integer,
    credit_rating_raw text,
    credit_rating_source text,
    action_required boolean DEFAULT false,
    action_type text,
    action_status text DEFAULT 'none'::text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_note text,
    archived_at timestamp with time zone,
    cia_processed boolean DEFAULT false,
    cia_processed_at timestamp with time zone,
    cia_decision text,
    run_id uuid,
    parent_event_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_demo boolean DEFAULT false NOT NULL,
    severity_score integer,
    correlation_id uuid,
    summary text,
    CONSTRAINT credit_events_action_status_check CHECK ((action_status = ANY (ARRAY['none'::text, 'pending'::text, 'auto_approved'::text, 'human_approved'::text, 'human_rejected'::text, 'executed'::text]))),
    CONSTRAINT credit_events_event_type_check CHECK ((event_type = ANY (ARRAY['NEWS_EVENT'::text, 'COVENANT_WAIVER'::text, 'CEO_DEPARTURE'::text, 'REVENUE_MISS'::text, 'GOING_CONCERN'::text, 'SEC_OTHER'::text, 'OVERDUE_AR'::text, 'UTILIZATION_THRESHOLD_BREACH'::text, 'PAYMENT_DETERIORATION'::text, 'PAYMENT_IMPROVEMENT'::text, 'PAYMENT_VOLATILITY'::text, 'COUNTRY_RATING_CHANGE'::text, 'COUNTRY_POLITICAL_RISK'::text, 'COUNTRY_ECONOMIC_SHOCK'::text, 'INTEREST_RATE_CHANGE'::text, 'INDUSTRY_DOWNTURN'::text, 'INDUSTRY_DISRUPTION'::text, 'REGULATORY_CHANGE'::text, 'TARIFF_CHANGE'::text, 'RISK_CHANGE'::text, 'CONCENTRATION_THRESHOLD_BREACH'::text, 'PORTFOLIO_INSIGHT'::text, 'CONCENTRATION_WARNING'::text, 'EXPANSION_OPPORTUNITY'::text, 'EMERGING_RISK_SIGNAL'::text, 'MACRO_TREND_WARNING'::text, 'FX_EXPOSURE_FLAG'::text, 'FX_HEDGING_NEEDED'::text, 'CURRENCY_VOLATILITY'::text]))),
    CONSTRAINT credit_events_rating_score_check CHECK (((credit_rating_score >= 0) AND (credit_rating_score <= 100))),
    CONSTRAINT credit_events_scope_check CHECK ((scope = ANY (ARRAY['customer'::text, 'country'::text, 'industry'::text, 'currency'::text, 'portfolio'::text]))),
    CONSTRAINT credit_events_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text, 'info'::text])))
);


--
-- Name: COLUMN credit_events.parent_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_events.parent_event_id IS 'V1 taxonomy: immediate parent event id. NULL for root events. (This column existed prior to V1 taxonomy and serves as the triggered_by field.)';


--
-- Name: COLUMN credit_events.severity_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_events.severity_score IS 'V1 taxonomy: numeric 0-100 severity, kept in sync with qualitative severity by publishEvent helper.';


--
-- Name: COLUMN credit_events.correlation_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_events.correlation_id IS 'V1 taxonomy: groups events in a cascade. Set to event id for root events.';


--
-- Name: COLUMN credit_events.summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.credit_events.summary IS 'V1 taxonomy: AI-generated summary for severity >= medium events; templated for lower severities.';


--
-- Name: credit_metric_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_metric_changes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    change_date date NOT NULL,
    metric_name text NOT NULL,
    old_value numeric,
    new_value numeric,
    source text,
    agent_name text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_metrics (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    credit_score integer,
    d_and_b_rating text,
    d_and_b_failure_score integer,
    altman_z_score numeric(6,2),
    debt_to_equity numeric(8,2),
    current_ratio numeric(6,2),
    quick_ratio numeric(6,2),
    interest_coverage numeric(6,2),
    cash_on_hand bigint,
    total_debt bigint,
    burn_rate_quarterly bigint,
    private_company boolean DEFAULT false,
    parent_company_guarantee boolean,
    last_financials_date date,
    financials_source text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT credit_metrics_credit_score_check CHECK (((credit_score >= 0) AND (credit_score <= 850)))
);


--
-- Name: customer_identifiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_identifiers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    id_type text NOT NULL,
    id_value text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    source text NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_identifiers_id_type_check CHECK ((id_type = ANY (ARRAY['duns'::text, 'ticker'::text, 'cik'::text, 'lei'::text, 'internal_customer_code'::text]))),
    CONSTRAINT customer_identifiers_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'edgar_verified'::text, 'customer_supplied'::text, 'duns_lookup'::text])))
);


--
-- Name: TABLE customer_identifiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_identifiers IS 'External identifiers (DUNS, ticker, CIK, LEI, internal_customer_code) for customer lookup. Single source of truth — see CreditPilot_Customer_Identifier_Strategy.md.';


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    company_name text NOT NULL,
    scenario public.scenario_type DEFAULT 'normal_operations'::public.scenario_type NOT NULL,
    industry text,
    market_cap_tier public.market_cap_tier,
    market_cap_usd bigint,
    headquarters text,
    credit_limit bigint DEFAULT 0 NOT NULL,
    current_exposure bigint DEFAULT 0 NOT NULL,
    payment_terms_days integer DEFAULT 45 NOT NULL,
    customer_since date,
    account_manager text,
    primary_contact text,
    primary_products text[] DEFAULT '{}'::text[],
    contract_expiry date,
    preferred_customer boolean DEFAULT false,
    notes text,
    last_reviewed date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    company_type text DEFAULT 'public'::text,
    credit_rating_score integer,
    credit_rating_raw text,
    credit_rating_source text,
    credit_rating_previous_score numeric,
    credit_rating_updated_at timestamp with time zone,
    risk_tags text[] DEFAULT '{}'::text[],
    risk_tags_updated_at timestamp with time zone,
    payment_on_time_rate numeric,
    payment_avg_days_early_late numeric,
    payment_trend text,
    payment_health text,
    payment_behaviour_updated_at timestamp with time zone,
    sector text NOT NULL,
    country_code text DEFAULT 'US'::text NOT NULL,
    CONSTRAINT customers_country_code_format CHECK ((country_code ~ '^[A-Z]{2}$'::text)),
    CONSTRAINT customers_credit_rating_previous_score_check CHECK (((credit_rating_previous_score IS NULL) OR ((credit_rating_previous_score >= (0)::numeric) AND (credit_rating_previous_score <= (100)::numeric)))),
    CONSTRAINT customers_credit_rating_score_check CHECK (((credit_rating_score IS NULL) OR ((credit_rating_score >= 0) AND (credit_rating_score <= 100)))),
    CONSTRAINT customers_payment_health_check CHECK (((payment_health = ANY (ARRAY['healthy'::text, 'watch'::text, 'at_risk'::text, 'unknown'::text])) OR (payment_health IS NULL))),
    CONSTRAINT customers_payment_trend_check CHECK (((payment_trend = ANY (ARRAY['improving'::text, 'stable'::text, 'deteriorating'::text, 'insufficient_data'::text])) OR (payment_trend IS NULL))),
    CONSTRAINT customers_sector_check CHECK ((sector = ANY (ARRAY['Aerospace & Defense'::text, 'Energy'::text, 'Industrial Manufacturing'::text, 'Materials'::text, 'Transportation'::text, 'Mining'::text, 'Other'::text])))
);


--
-- Name: COLUMN customers.sector; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customers.sector IS 'Canonical sector enum for aggregation. industry column remains as freeform descriptor.';


--
-- Name: COLUMN customers.country_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customers.country_code IS 'ISO 3166-1 alpha-2 country code. Country of the company''s registered/billing address.';


--
-- Name: growth_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.growth_signals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    growth_trajectory text,
    revenue_growth_yoy numeric(6,4),
    backlog_amount bigint,
    backlog_description text,
    recent_milestones text[] DEFAULT '{}'::text[],
    credit_limit_increase_recommended boolean DEFAULT false,
    recommended_new_limit bigint,
    rationale text,
    upsell_opportunity text,
    agent_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    invoice_number text NOT NULL,
    invoice_amount bigint NOT NULL,
    amount_paid bigint DEFAULT 0 NOT NULL,
    amount_outstanding bigint GENERATED ALWAYS AS ((invoice_amount - amount_paid)) STORED,
    invoice_date date,
    due_date date NOT NULL,
    days_overdue integer DEFAULT 0 NOT NULL,
    status public.invoice_status DEFAULT 'current'::public.invoice_status NOT NULL,
    dunning_stage public.dunning_stage,
    dunning_sent_date date,
    escalated_to_collections boolean DEFAULT false,
    claimable boolean DEFAULT false,
    product_description text,
    purchase_order_number text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    uploaded_at timestamp with time zone,
    upload_source text,
    is_demo boolean DEFAULT false NOT NULL,
    outstanding_amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text
);


--
-- Name: negative_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.negative_news (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    news_date date NOT NULL,
    headline text NOT NULL,
    source text,
    sentiment_score numeric(4,2),
    url text,
    summary text,
    category text,
    severity text DEFAULT 'medium'::text,
    reviewed boolean DEFAULT false,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    action_taken text,
    agent_name text,
    created_at timestamp with time zone DEFAULT now(),
    content_fingerprint text,
    is_demo boolean DEFAULT false NOT NULL,
    classification_source text DEFAULT 'keyword'::text,
    confidence numeric DEFAULT 0.5,
    provider text DEFAULT 'manual'::text,
    relevance_score numeric,
    CONSTRAINT negative_news_sentiment_score_check CHECK (((sentiment_score >= ('-1'::integer)::numeric) AND (sentiment_score <= (1)::numeric))),
    CONSTRAINT negative_news_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    invoice_id uuid,
    invoice_number text,
    payment_date date NOT NULL,
    amount_paid bigint NOT NULL,
    payment_method public.payment_method DEFAULT 'wire_transfer'::public.payment_method,
    reference_number text,
    invoice_date date,
    invoice_due_date date,
    days_to_pay integer,
    days_early_late integer,
    is_partial_payment boolean DEFAULT false,
    notes text,
    posted_by text DEFAULT 'system'::text,
    created_at timestamp with time zone DEFAULT now(),
    on_time boolean,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: pending_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    agent_name text NOT NULL,
    message_id uuid,
    action_type text NOT NULL,
    rationale text NOT NULL,
    current_value bigint,
    proposed_value bigint,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_note text,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    CONSTRAINT pending_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text])))
);


--
-- Name: sec_filings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sec_filings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    filing_date date NOT NULL,
    filing_type text NOT NULL,
    accession_number text,
    url text,
    key_findings text,
    risk_signals text[] DEFAULT '{}'::text[],
    reviewed boolean DEFAULT false,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    agent_name text,
    created_at timestamp with time zone DEFAULT now(),
    is_demo boolean DEFAULT false NOT NULL,
    document_url text,
    cik text,
    provider text DEFAULT 'edgar'::text
);


--
-- Name: sec_monitoring; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sec_monitoring (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    cik text NOT NULL,
    monitoring_active boolean DEFAULT true,
    filing_types_monitored text[] DEFAULT ARRAY['10-K'::text, '10-Q'::text, '8-K'::text],
    last_10k_date date,
    last_10q_date date,
    last_8k_date date,
    risk_signals_detected text[] DEFAULT '{}'::text[],
    alert_triggered boolean DEFAULT false,
    alert_date date,
    alert_action_taken text,
    next_scheduled_review date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_checked_at timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL
);


--
-- Name: seed_news; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_news (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    customer_id uuid NOT NULL,
    company_name text NOT NULL,
    headline text NOT NULL,
    summary text NOT NULL,
    url text,
    source text NOT NULL,
    published_date date NOT NULL,
    relevance_score numeric DEFAULT 0.9 NOT NULL,
    provider text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: seed_sec_filings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_sec_filings (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    cik text NOT NULL,
    company_name text NOT NULL,
    filing_type text NOT NULL,
    filing_date date NOT NULL,
    accession_number text NOT NULL,
    document_url text NOT NULL,
    risk_signals text[] DEFAULT '{}'::text[] NOT NULL,
    key_findings text DEFAULT ''::text NOT NULL,
    provider text DEFAULT 'edgar'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_ar_aging_current; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_ar_aging_current AS
 SELECT c.id AS customer_id,
    c.company_name,
    ti.id_value AS ticker,
    c.account_manager,
    c.scenario,
    c.payment_terms_days,
    a.snapshot_date,
    a.current_amount,
    a.bucket_1_30,
    a.bucket_31_60,
    a.bucket_61_90,
    a.bucket_over_90,
    a.pre_petition_amount,
    a.total_outstanding,
    a.current_count,
    a.bucket_1_30_count,
    a.bucket_31_60_count,
    a.bucket_61_90_count,
    a.bucket_over_90_count,
    a.total_invoice_count,
    a.credit_limit,
    a.utilization_pct,
        CASE
            WHEN ((a.bucket_over_90 > 0) OR (a.pre_petition_amount > 0)) THEN 'CRITICAL'::text
            WHEN (a.bucket_61_90 > 0) THEN 'HIGH'::text
            WHEN (a.bucket_31_60 > 0) THEN 'MEDIUM'::text
            WHEN (a.bucket_1_30 > 0) THEN 'LOW'::text
            ELSE 'CURRENT'::text
        END AS risk_tier
   FROM ((public.customers c
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
     JOIN LATERAL ( SELECT s.id,
            s.customer_id,
            s.snapshot_date,
            s.current_amount,
            s.bucket_1_30,
            s.bucket_31_60,
            s.bucket_61_90,
            s.bucket_over_90,
            s.total_outstanding,
            s.current_count,
            s.bucket_1_30_count,
            s.bucket_31_60_count,
            s.bucket_61_90_count,
            s.bucket_over_90_count,
            s.total_invoice_count,
            s.pre_petition_amount,
            s.credit_limit,
            s.utilization_pct,
            s.generated_by,
            s.created_at
           FROM public.ar_aging_snapshots s
          WHERE (s.customer_id = c.id)
          ORDER BY s.snapshot_date DESC
         LIMIT 1) a ON (true))
  ORDER BY
        CASE
            WHEN ((a.bucket_over_90 > 0) OR (a.pre_petition_amount > 0)) THEN 1
            WHEN (a.bucket_61_90 > 0) THEN 2
            WHEN (a.bucket_31_60 > 0) THEN 3
            WHEN (a.bucket_1_30 > 0) THEN 4
            ELSE 5
        END, a.total_outstanding DESC;


--
-- Name: v_ar_aging_portfolio; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_ar_aging_portfolio AS
 SELECT count(DISTINCT customer_id) AS customer_count,
    sum(current_amount) AS total_current,
    sum(bucket_1_30) AS total_1_30,
    sum(bucket_31_60) AS total_31_60,
    sum(bucket_61_90) AS total_61_90,
    sum(bucket_over_90) AS total_over_90,
    sum(pre_petition_amount) AS total_pre_petition,
    sum(total_outstanding) AS total_outstanding,
    round(((sum(current_amount) / NULLIF(sum(total_outstanding), (0)::numeric)) * (100)::numeric), 1) AS pct_current,
    round(((sum(bucket_1_30) / NULLIF(sum(total_outstanding), (0)::numeric)) * (100)::numeric), 1) AS pct_1_30,
    round(((sum(bucket_31_60) / NULLIF(sum(total_outstanding), (0)::numeric)) * (100)::numeric), 1) AS pct_31_60,
    round(((sum(bucket_61_90) / NULLIF(sum(total_outstanding), (0)::numeric)) * (100)::numeric), 1) AS pct_61_90,
    round(((sum(bucket_over_90) / NULLIF(sum(total_outstanding), (0)::numeric)) * (100)::numeric), 1) AS pct_over_90,
    snapshot_date
   FROM ( SELECT DISTINCT ON (ar_aging_snapshots.customer_id) ar_aging_snapshots.id,
            ar_aging_snapshots.customer_id,
            ar_aging_snapshots.snapshot_date,
            ar_aging_snapshots.current_amount,
            ar_aging_snapshots.bucket_1_30,
            ar_aging_snapshots.bucket_31_60,
            ar_aging_snapshots.bucket_61_90,
            ar_aging_snapshots.bucket_over_90,
            ar_aging_snapshots.total_outstanding,
            ar_aging_snapshots.current_count,
            ar_aging_snapshots.bucket_1_30_count,
            ar_aging_snapshots.bucket_31_60_count,
            ar_aging_snapshots.bucket_61_90_count,
            ar_aging_snapshots.bucket_over_90_count,
            ar_aging_snapshots.total_invoice_count,
            ar_aging_snapshots.pre_petition_amount,
            ar_aging_snapshots.credit_limit,
            ar_aging_snapshots.utilization_pct,
            ar_aging_snapshots.generated_by,
            ar_aging_snapshots.created_at
           FROM public.ar_aging_snapshots
          ORDER BY ar_aging_snapshots.customer_id, ar_aging_snapshots.snapshot_date DESC) latest
  GROUP BY snapshot_date;


--
-- Name: v_bankruptcy_claims; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_bankruptcy_claims AS
 SELECT c.company_name,
    ti.id_value AS ticker,
    bd.filing_date,
    bd.case_number,
    bd.court,
    bd.chapter,
    bd.status,
    bd.proof_of_claim_filed,
    bd.proof_of_claim_amount,
    bd.estimated_recovery_rate,
    bd.estimated_recovery_amount,
    bd.total_pre_petition_claim,
    bd.emergence_date_estimated,
    ( SELECT count(*) AS count
           FROM public.invoices i
          WHERE ((i.customer_id = c.id) AND (i.claimable = true))) AS claimable_invoice_count,
    ( SELECT COALESCE(sum(i.amount_outstanding), (0)::numeric) AS "coalesce"
           FROM public.invoices i
          WHERE ((i.customer_id = c.id) AND (i.claimable = true))) AS claimable_total
   FROM ((public.customers c
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
     JOIN public.bankruptcy_details bd ON ((bd.customer_id = c.id)))
  ORDER BY bd.filing_date DESC;


--
-- Name: v_customers_at_risk; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_customers_at_risk AS
 SELECT c.id,
    c.company_name,
    ti.id_value AS ticker,
    c.scenario,
    c.credit_limit,
    c.current_exposure,
    round((((c.current_exposure)::numeric / (NULLIF(c.credit_limit, 0))::numeric) * (100)::numeric), 1) AS utilization_pct,
    c.credit_rating_score,
    c.notes,
    c.account_manager,
    ( SELECT round(avg(pt.days_early_late)) AS round
           FROM public.payment_transactions pt
          WHERE (pt.customer_id = c.id)) AS avg_days_early_late,
    ( SELECT round((avg(
                CASE
                    WHEN pt.on_time THEN 1.0
                    ELSE 0.0
                END) * (100)::numeric), 1) AS round
           FROM public.payment_transactions pt
          WHERE (pt.customer_id = c.id)) AS on_time_pct,
    ( SELECT count(*) AS count
           FROM public.invoices i
          WHERE ((i.customer_id = c.id) AND (i.days_overdue > 0))) AS overdue_invoice_count,
    ( SELECT COALESCE(sum(i.amount_outstanding), (0)::numeric) AS "coalesce"
           FROM public.invoices i
          WHERE ((i.customer_id = c.id) AND (i.days_overdue > 0))) AS overdue_amount,
    ( SELECT max(i.days_overdue) AS max
           FROM public.invoices i
          WHERE (i.customer_id = c.id)) AS max_days_overdue
   FROM (public.customers c
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
  WHERE ((c.current_exposure > 0) AND ((c.credit_rating_score < 30) OR (c.scenario = 'bankruptcy'::public.scenario_type) OR ('BANKRUPTCY'::text = ANY (c.risk_tags)) OR (EXISTS ( SELECT 1
           FROM public.credit_events e
          WHERE ((e.customer_id = c.id) AND (e.event_type = 'GOING_CONCERN'::text)))) OR (COALESCE(( SELECT s.pre_petition_amount
           FROM public.ar_aging_snapshots s
          WHERE (s.customer_id = c.id)
          ORDER BY s.snapshot_date DESC
         LIMIT 1), (0)::bigint) > 0)))
  ORDER BY c.current_exposure DESC;


--
-- Name: v_growth_opportunities; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_growth_opportunities AS
 SELECT c.id,
    c.company_name,
    ti.id_value AS ticker,
    c.credit_limit,
    c.current_exposure,
    c.account_manager,
    gs.growth_trajectory,
    gs.revenue_growth_yoy,
    gs.backlog_amount,
    gs.recommended_new_limit,
    gs.rationale,
    gs.upsell_opportunity,
    gs.recent_milestones
   FROM ((public.customers c
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
     JOIN public.growth_signals gs ON ((gs.customer_id = c.id)))
  WHERE (gs.credit_limit_increase_recommended = true)
  ORDER BY gs.recommended_new_limit DESC;


--
-- Name: v_overdue_invoices; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_overdue_invoices AS
 SELECT c.company_name,
    ti.id_value AS ticker,
    c.scenario,
    c.account_manager,
    i.invoice_number,
    i.invoice_amount,
    i.amount_paid,
    i.amount_outstanding,
    i.invoice_date,
    i.due_date,
    i.days_overdue,
    i.status,
    i.dunning_stage,
    i.escalated_to_collections,
    i.claimable,
        CASE
            WHEN (i.days_overdue >= 90) THEN 'CRITICAL'::text
            WHEN (i.days_overdue >= 60) THEN 'SEVERE'::text
            WHEN (i.days_overdue >= 30) THEN 'WARNING'::text
            ELSE 'MONITOR'::text
        END AS risk_tier
   FROM ((public.invoices i
     JOIN public.customers c ON ((c.id = i.customer_id)))
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
  WHERE (i.days_overdue > 0)
  ORDER BY i.days_overdue DESC;


--
-- Name: v_payment_behaviour; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_payment_behaviour AS
 SELECT c.id AS customer_id,
    c.company_name,
    ti.id_value AS ticker,
    c.payment_terms_days,
    c.account_manager,
    count(pt.id) AS total_payments,
    COALESCE(sum(pt.amount_paid), (0)::numeric) AS total_paid_all_time,
    COALESCE(sum(pt.amount_paid) FILTER (WHERE (pt.payment_date >= (CURRENT_DATE - '1 year'::interval))), (0)::numeric) AS total_paid_12mo,
    round(avg(pt.days_to_pay), 1) AS avg_days_to_pay,
    round(avg(pt.days_early_late), 1) AS avg_days_early_late,
    round((avg(
        CASE
            WHEN pt.on_time THEN 1.0
            ELSE 0.0
        END) * (100)::numeric), 1) AS on_time_payment_pct,
    max(pt.payment_date) AS last_payment_date,
    ( SELECT payment_transactions.amount_paid
           FROM public.payment_transactions
          WHERE (payment_transactions.customer_id = c.id)
          ORDER BY payment_transactions.payment_date DESC
         LIMIT 1) AS last_payment_amount,
    round(avg(pt.days_to_pay) FILTER (WHERE (pt.payment_date >= (CURRENT_DATE - '6 mons'::interval))), 1) AS avg_days_to_pay_last_6mo,
    round(avg(pt.days_to_pay) FILTER (WHERE ((pt.payment_date >= (CURRENT_DATE - '1 year'::interval)) AND (pt.payment_date <= (CURRENT_DATE - '6 mons'::interval)))), 1) AS avg_days_to_pay_prior_6mo
   FROM ((public.customers c
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
     LEFT JOIN public.payment_transactions pt ON ((pt.customer_id = c.id)))
  GROUP BY c.id, c.company_name, ti.id_value, c.payment_terms_days, c.account_manager;


--
-- Name: v_portfolio_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_portfolio_overview AS
 SELECT count(*) AS total_customers,
    sum(credit_limit) AS total_credit_limits,
    sum(current_exposure) AS total_exposure,
    round(avg(credit_limit)) AS avg_credit_limit,
    round(((sum(current_exposure) / NULLIF(sum(credit_limit), (0)::numeric)) * (100)::numeric), 1) AS portfolio_utilization_pct,
    count(*) FILTER (WHERE (scenario = 'normal_operations'::public.scenario_type)) AS normal_count,
    count(*) FILTER (WHERE (scenario = 'payment_issues'::public.scenario_type)) AS payment_issues_count,
    count(*) FILTER (WHERE (scenario = 'credit_deterioration'::public.scenario_type)) AS credit_deterioration_count,
    count(*) FILTER (WHERE (scenario = 'negative_news'::public.scenario_type)) AS negative_news_count,
    count(*) FILTER (WHERE (scenario = 'bankruptcy'::public.scenario_type)) AS bankruptcy_count,
    count(*) FILTER (WHERE (scenario = 'growth_opportunity'::public.scenario_type)) AS growth_count,
    count(*) FILTER (WHERE (scenario = 'sec_filing_monitoring'::public.scenario_type)) AS sec_monitoring_count,
    count(*) FILTER (WHERE ((current_exposure > 0) AND ((credit_rating_score < 30) OR (scenario = 'bankruptcy'::public.scenario_type) OR ('BANKRUPTCY'::text = ANY (risk_tags)) OR (EXISTS ( SELECT 1
           FROM public.credit_events e
          WHERE ((e.customer_id = customers.id) AND (e.event_type = 'GOING_CONCERN'::text)))) OR (COALESCE(( SELECT s.pre_petition_amount
           FROM public.ar_aging_snapshots s
          WHERE (s.customer_id = customers.id)
          ORDER BY s.snapshot_date DESC
         LIMIT 1), (0)::bigint) > 0)))) AS high_risk_count
   FROM public.customers;


--
-- Name: v_sec_monitoring_dashboard; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_sec_monitoring_dashboard AS
 SELECT c.id AS customer_id,
    c.company_name,
    ti.id_value AS ticker,
    sm.cik,
    sm.monitoring_active,
    sm.last_10k_date,
    sm.last_10q_date,
    sm.last_8k_date,
    sm.risk_signals_detected,
    sm.alert_triggered,
    sm.alert_date,
    sm.alert_action_taken,
    sm.next_scheduled_review,
    ( SELECT count(*) AS count
           FROM public.sec_filings sf
          WHERE (sf.customer_id = c.id)) AS total_filings,
    ( SELECT count(*) AS count
           FROM public.sec_filings sf
          WHERE ((sf.customer_id = c.id) AND (sf.reviewed = false))) AS unreviewed_filings
   FROM ((public.customers c
     LEFT JOIN public.customer_identifiers ti ON (((ti.customer_id = c.id) AND (ti.id_type = 'ticker'::text) AND (ti.is_primary = true))))
     JOIN public.sec_monitoring sm ON ((sm.customer_id = c.id)))
  WHERE (sm.monitoring_active = true)
  ORDER BY sm.alert_triggered DESC, sm.last_10q_date DESC;


--
-- Name: agent_messages agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);


--
-- Name: agent_processed_events agent_processed_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_processed_events
    ADD CONSTRAINT agent_processed_events_pkey PRIMARY KEY (agent_name, event_id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: ar_aging_snapshots ar_aging_snapshots_customer_id_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_aging_snapshots
    ADD CONSTRAINT ar_aging_snapshots_customer_id_snapshot_date_key UNIQUE (customer_id, snapshot_date);


--
-- Name: ar_aging_snapshots ar_aging_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_aging_snapshots
    ADD CONSTRAINT ar_aging_snapshots_pkey PRIMARY KEY (id);


--
-- Name: bankruptcy_details bankruptcy_details_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bankruptcy_details
    ADD CONSTRAINT bankruptcy_details_customer_id_key UNIQUE (customer_id);


--
-- Name: bankruptcy_details bankruptcy_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bankruptcy_details
    ADD CONSTRAINT bankruptcy_details_pkey PRIMARY KEY (id);


--
-- Name: company company_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company
    ADD CONSTRAINT company_pkey PRIMARY KEY (id);


--
-- Name: credit_actions credit_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_actions
    ADD CONSTRAINT credit_actions_pkey PRIMARY KEY (id);


--
-- Name: credit_events credit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_events
    ADD CONSTRAINT credit_events_pkey PRIMARY KEY (id);


--
-- Name: credit_metric_changes credit_metric_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_metric_changes
    ADD CONSTRAINT credit_metric_changes_pkey PRIMARY KEY (id);


--
-- Name: credit_metrics credit_metrics_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_metrics
    ADD CONSTRAINT credit_metrics_customer_id_key UNIQUE (customer_id);


--
-- Name: credit_metrics credit_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_metrics
    ADD CONSTRAINT credit_metrics_pkey PRIMARY KEY (id);


--
-- Name: customer_identifiers customer_identifiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_identifiers
    ADD CONSTRAINT customer_identifiers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: growth_signals growth_signals_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_signals
    ADD CONSTRAINT growth_signals_customer_id_key UNIQUE (customer_id);


--
-- Name: growth_signals growth_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_signals
    ADD CONSTRAINT growth_signals_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: negative_news negative_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.negative_news
    ADD CONSTRAINT negative_news_pkey PRIMARY KEY (id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: pending_actions pending_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_actions
    ADD CONSTRAINT pending_actions_pkey PRIMARY KEY (id);


--
-- Name: sec_filings sec_filings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sec_filings
    ADD CONSTRAINT sec_filings_pkey PRIMARY KEY (id);


--
-- Name: sec_monitoring sec_monitoring_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sec_monitoring
    ADD CONSTRAINT sec_monitoring_customer_id_key UNIQUE (customer_id);


--
-- Name: sec_monitoring sec_monitoring_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sec_monitoring
    ADD CONSTRAINT sec_monitoring_pkey PRIMARY KEY (id);


--
-- Name: seed_news seed_news_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_news
    ADD CONSTRAINT seed_news_pkey PRIMARY KEY (id);


--
-- Name: seed_sec_filings seed_sec_filings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_sec_filings
    ADD CONSTRAINT seed_sec_filings_pkey PRIMARY KEY (id);


--
-- Name: agent_processed_events_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_processed_events_event_id_idx ON public.agent_processed_events USING btree (event_id);


--
-- Name: credit_events_correlation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_events_correlation_id_idx ON public.credit_events USING btree (correlation_id);


--
-- Name: customer_identifiers_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_identifiers_customer_idx ON public.customer_identifiers USING btree (customer_id);


--
-- Name: customer_identifiers_primary_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_identifiers_primary_uq ON public.customer_identifiers USING btree (customer_id, id_type) WHERE (is_primary = true);


--
-- Name: customer_identifiers_type_value_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_identifiers_type_value_uq ON public.customer_identifiers USING btree (id_type, id_value);


--
-- Name: customers_sector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_sector_idx ON public.customers USING btree (sector);


--
-- Name: idx_actions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_customer ON public.credit_actions USING btree (customer_id);


--
-- Name: idx_actions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_date ON public.credit_actions USING btree (action_date);


--
-- Name: idx_actions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_type ON public.credit_actions USING btree (action_type);


--
-- Name: idx_agent_msgs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_msgs_agent ON public.agent_messages USING btree (agent_name);


--
-- Name: idx_agent_msgs_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_msgs_channel ON public.agent_messages USING btree (channel);


--
-- Name: idx_agent_msgs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_msgs_created ON public.agent_messages USING btree (created_at DESC);


--
-- Name: idx_agent_msgs_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_msgs_customer ON public.agent_messages USING btree (customer_id);


--
-- Name: idx_agent_msgs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_msgs_run ON public.agent_messages USING btree (run_id);


--
-- Name: idx_agent_msgs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_msgs_status ON public.agent_messages USING btree (status);


--
-- Name: idx_agent_runs_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_agent ON public.agent_runs USING btree (agent_name);


--
-- Name: idx_agent_runs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_started ON public.agent_runs USING btree (started_at DESC);


--
-- Name: idx_agent_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_status ON public.agent_runs USING btree (status);


--
-- Name: idx_aging_cust_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aging_cust_date ON public.ar_aging_snapshots USING btree (customer_id, snapshot_date DESC);


--
-- Name: idx_aging_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_aging_date ON public.ar_aging_snapshots USING btree (snapshot_date);


--
-- Name: idx_cm_altman; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cm_altman ON public.credit_metrics USING btree (altman_z_score);


--
-- Name: idx_cm_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cm_customer ON public.credit_metrics USING btree (customer_id);


--
-- Name: idx_cm_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cm_score ON public.credit_metrics USING btree (credit_score);


--
-- Name: idx_cmc_customer_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmc_customer_date ON public.credit_metric_changes USING btree (customer_id, change_date);


--
-- Name: idx_credit_events_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_active ON public.credit_events USING btree (archived_at) WHERE (archived_at IS NULL);


--
-- Name: idx_credit_events_cia_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_cia_unprocessed ON public.credit_events USING btree (cia_processed, created_at DESC) WHERE (cia_processed = false);


--
-- Name: idx_credit_events_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_created ON public.credit_events USING btree (created_at DESC);


--
-- Name: idx_credit_events_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_customer ON public.credit_events USING btree (customer_id);


--
-- Name: idx_credit_events_customer_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_customer_severity ON public.credit_events USING btree (customer_id, severity, created_at DESC);


--
-- Name: idx_credit_events_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_scope ON public.credit_events USING btree (scope);


--
-- Name: idx_credit_events_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_severity ON public.credit_events USING btree (severity);


--
-- Name: idx_credit_events_source_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_source_agent ON public.credit_events USING btree (source_agent, created_at DESC);


--
-- Name: idx_credit_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_type ON public.credit_events USING btree (event_type);


--
-- Name: idx_credit_events_unprocessed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_events_unprocessed ON public.credit_events USING btree (cia_processed) WHERE (cia_processed = false);


--
-- Name: idx_customers_acct_mgr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_acct_mgr ON public.customers USING btree (account_manager);


--
-- Name: idx_customers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name_trgm ON public.customers USING gin (company_name public.gin_trgm_ops);


--
-- Name: idx_customers_scenario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_scenario ON public.customers USING btree (scenario);


--
-- Name: idx_invoices_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer ON public.invoices USING btree (customer_id);


--
-- Name: idx_invoices_customer_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer_status ON public.invoices USING btree (customer_id, status);


--
-- Name: idx_invoices_customer_uploaded; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_customer_uploaded ON public.invoices USING btree (customer_id, uploaded_at);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_overdue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_overdue ON public.invoices USING btree (days_overdue) WHERE (days_overdue > 0);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_news_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_customer ON public.negative_news USING btree (customer_id);


--
-- Name: idx_news_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_date ON public.negative_news USING btree (news_date);


--
-- Name: idx_news_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_severity ON public.negative_news USING btree (severity);


--
-- Name: idx_news_unreviewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_news_unreviewed ON public.negative_news USING btree (reviewed) WHERE (reviewed = false);


--
-- Name: idx_pending_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_created ON public.pending_actions USING btree (created_at DESC);


--
-- Name: idx_pending_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_customer ON public.pending_actions USING btree (customer_id);


--
-- Name: idx_pending_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_run ON public.pending_actions USING btree (run_id);


--
-- Name: idx_pending_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_status ON public.pending_actions USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_pmttxn_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pmttxn_customer ON public.payment_transactions USING btree (customer_id);


--
-- Name: idx_pmttxn_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pmttxn_date ON public.payment_transactions USING btree (payment_date);


--
-- Name: idx_pmttxn_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pmttxn_invoice ON public.payment_transactions USING btree (invoice_id) WHERE (invoice_id IS NOT NULL);


--
-- Name: idx_sec_filings_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_filings_customer ON public.sec_filings USING btree (customer_id);


--
-- Name: idx_sec_filings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_filings_date ON public.sec_filings USING btree (filing_date);


--
-- Name: idx_sec_mon_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_mon_alert ON public.sec_monitoring USING btree (alert_triggered) WHERE (alert_triggered = true);


--
-- Name: idx_sec_mon_cik; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sec_mon_cik ON public.sec_monitoring USING btree (cik);


--
-- Name: negative_news_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX negative_news_fingerprint_idx ON public.negative_news USING btree (content_fingerprint) WHERE (content_fingerprint IS NOT NULL);


--
-- Name: sec_filings_accession_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sec_filings_accession_idx ON public.sec_filings USING btree (accession_number) WHERE (accession_number IS NOT NULL);


--
-- Name: seed_news_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_news_customer_id_idx ON public.seed_news USING btree (customer_id);


--
-- Name: seed_sec_filings_cik_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX seed_sec_filings_cik_idx ON public.seed_sec_filings USING btree (cik);


--
-- Name: bankruptcy_details trg_bankruptcy_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bankruptcy_upd BEFORE UPDATE ON public.bankruptcy_details FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: company trg_company_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_company_upd BEFORE UPDATE ON public.company FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: credit_metrics trg_credit_metrics_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_credit_metrics_upd BEFORE UPDATE ON public.credit_metrics FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: customer_identifiers trg_customer_identifiers_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customer_identifiers_upd BEFORE UPDATE ON public.customer_identifiers FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: customers trg_customers_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_upd BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: invoices trg_exposure_recalc; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_exposure_recalc AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recalculate_exposure();


--
-- Name: growth_signals trg_growth_signals_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_growth_signals_upd BEFORE UPDATE ON public.growth_signals FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: invoices trg_invoices_upd; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoices_upd BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: agent_messages agent_messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: agent_messages agent_messages_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;


--
-- Name: agent_processed_events agent_processed_events_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_processed_events
    ADD CONSTRAINT agent_processed_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.credit_events(id) ON DELETE CASCADE;


--
-- Name: ar_aging_snapshots ar_aging_snapshots_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_aging_snapshots
    ADD CONSTRAINT ar_aging_snapshots_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: bankruptcy_details bankruptcy_details_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bankruptcy_details
    ADD CONSTRAINT bankruptcy_details_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: credit_actions credit_actions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_actions
    ADD CONSTRAINT credit_actions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: credit_events credit_events_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_events
    ADD CONSTRAINT credit_events_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: credit_events credit_events_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_events
    ADD CONSTRAINT credit_events_parent_fk FOREIGN KEY (parent_event_id) REFERENCES public.credit_events(id);


--
-- Name: credit_events credit_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_events
    ADD CONSTRAINT credit_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id);


--
-- Name: credit_metric_changes credit_metric_changes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_metric_changes
    ADD CONSTRAINT credit_metric_changes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: credit_metrics credit_metrics_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_metrics
    ADD CONSTRAINT credit_metrics_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_identifiers customer_identifiers_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_identifiers
    ADD CONSTRAINT customer_identifiers_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: growth_signals growth_signals_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.growth_signals
    ADD CONSTRAINT growth_signals_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: negative_news negative_news_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.negative_news
    ADD CONSTRAINT negative_news_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: payment_transactions payment_transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: payment_transactions payment_transactions_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: pending_actions pending_actions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_actions
    ADD CONSTRAINT pending_actions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: pending_actions pending_actions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_actions
    ADD CONSTRAINT pending_actions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id) ON DELETE SET NULL;


--
-- Name: pending_actions pending_actions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_actions
    ADD CONSTRAINT pending_actions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;


--
-- Name: sec_filings sec_filings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sec_filings
    ADD CONSTRAINT sec_filings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: sec_monitoring sec_monitoring_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sec_monitoring
    ADD CONSTRAINT sec_monitoring_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: seed_news seed_news_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_news
    ADD CONSTRAINT seed_news_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: negative_news Public insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public insert" ON public.negative_news FOR INSERT WITH CHECK (true);


--
-- Name: agent_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_runs anon_insert_agent_runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_agent_runs ON public.agent_runs FOR INSERT WITH CHECK ((auth.role() = 'anon'::text));


--
-- Name: credit_actions anon_insert_credit_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_credit_actions ON public.credit_actions FOR INSERT WITH CHECK ((auth.role() = 'anon'::text));


--
-- Name: credit_events anon_insert_credit_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_credit_events ON public.credit_events FOR INSERT TO anon WITH CHECK (true);


--
-- Name: sec_monitoring anon_insert_sec_monitoring; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_insert_sec_monitoring ON public.sec_monitoring FOR INSERT TO anon WITH CHECK (true);


--
-- Name: agent_messages anon_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select ON public.agent_messages FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: agent_runs anon_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select ON public.agent_runs FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: pending_actions anon_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select ON public.pending_actions FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: ar_aging_snapshots anon_select_ar_aging; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_ar_aging ON public.ar_aging_snapshots FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: ar_aging_snapshots anon_select_ar_aging_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_ar_aging_snapshots ON public.ar_aging_snapshots FOR SELECT TO anon USING (true);


--
-- Name: bankruptcy_details anon_select_bankruptcy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_bankruptcy ON public.bankruptcy_details FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: company anon_select_company; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_company ON public.company FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: credit_actions anon_select_credit_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_credit_actions ON public.credit_actions FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: credit_events anon_select_credit_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_credit_events ON public.credit_events FOR SELECT TO anon USING (true);


--
-- Name: credit_metrics anon_select_credit_metrics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_credit_metrics ON public.credit_metrics FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: customer_identifiers anon_select_customer_identifiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_customer_identifiers ON public.customer_identifiers FOR SELECT TO anon USING (true);


--
-- Name: customers anon_select_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_customers ON public.customers FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: growth_signals anon_select_growth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_growth ON public.growth_signals FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: invoices anon_select_invoices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_invoices ON public.invoices FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: negative_news anon_select_negative_news; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_negative_news ON public.negative_news FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: payment_transactions anon_select_payment_txn; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_payment_txn ON public.payment_transactions FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: sec_filings anon_select_sec_filings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_sec_filings ON public.sec_filings FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: sec_monitoring anon_select_sec_monitoring; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_select_sec_monitoring ON public.sec_monitoring FOR SELECT USING ((auth.role() = 'anon'::text));


--
-- Name: credit_events anon_update_credit_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_credit_events ON public.credit_events FOR UPDATE TO anon USING (true);


--
-- Name: customers anon_update_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_customers ON public.customers FOR UPDATE USING ((auth.role() = 'anon'::text));


--
-- Name: negative_news anon_update_negative_news; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_negative_news ON public.negative_news FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: pending_actions anon_update_pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_pending ON public.pending_actions FOR UPDATE USING ((auth.role() = 'anon'::text));


--
-- Name: sec_monitoring anon_update_sec_monitoring; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY anon_update_sec_monitoring ON public.sec_monitoring FOR UPDATE TO anon USING (true) WITH CHECK (true);


--
-- Name: ar_aging_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_aging_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_messages auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.agent_messages FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: agent_runs auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.agent_runs FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: ar_aging_snapshots auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.ar_aging_snapshots FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: bankruptcy_details auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.bankruptcy_details FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: company auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.company FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: credit_actions auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.credit_actions FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: credit_metric_changes auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.credit_metric_changes FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: credit_metrics auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.credit_metrics FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: customers auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.customers FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: growth_signals auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.growth_signals FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: invoices auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.invoices FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: negative_news auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.negative_news FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: payment_transactions auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.payment_transactions FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: pending_actions auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.pending_actions FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: sec_filings auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.sec_filings FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: sec_monitoring auth_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_select ON public.sec_monitoring FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: bankruptcy_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bankruptcy_details ENABLE ROW LEVEL SECURITY;

--
-- Name: company; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_metric_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_metric_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_identifiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_identifiers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: growth_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.growth_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: negative_news; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.negative_news ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: sec_filings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sec_filings ENABLE ROW LEVEL SECURITY;

--
-- Name: sec_monitoring; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sec_monitoring ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_messages service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.agent_messages USING ((auth.role() = 'service_role'::text));


--
-- Name: agent_runs service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.agent_runs USING ((auth.role() = 'service_role'::text));


--
-- Name: ar_aging_snapshots service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.ar_aging_snapshots USING ((auth.role() = 'service_role'::text));


--
-- Name: bankruptcy_details service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.bankruptcy_details USING ((auth.role() = 'service_role'::text));


--
-- Name: company service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.company USING ((auth.role() = 'service_role'::text));


--
-- Name: credit_actions service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.credit_actions USING ((auth.role() = 'service_role'::text));


--
-- Name: credit_metric_changes service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.credit_metric_changes USING ((auth.role() = 'service_role'::text));


--
-- Name: credit_metrics service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.credit_metrics USING ((auth.role() = 'service_role'::text));


--
-- Name: customers service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.customers USING ((auth.role() = 'service_role'::text));


--
-- Name: growth_signals service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.growth_signals USING ((auth.role() = 'service_role'::text));


--
-- Name: invoices service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.invoices USING ((auth.role() = 'service_role'::text));


--
-- Name: negative_news service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.negative_news USING ((auth.role() = 'service_role'::text));


--
-- Name: payment_transactions service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.payment_transactions USING ((auth.role() = 'service_role'::text));


--
-- Name: pending_actions service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.pending_actions USING ((auth.role() = 'service_role'::text));


--
-- Name: sec_filings service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.sec_filings USING ((auth.role() = 'service_role'::text));


--
-- Name: sec_monitoring service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all ON public.sec_monitoring USING ((auth.role() = 'service_role'::text));


--
-- Name: credit_events service_all_credit_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all_credit_events ON public.credit_events TO service_role USING (true);


--
-- Name: customer_identifiers service_all_customer_identifiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_all_customer_identifiers ON public.customer_identifiers TO service_role USING (true);


--
-- PostgreSQL database dump complete
--


