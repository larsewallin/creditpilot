-- F1: add pre_petition guard to the three mid-range bucket filters (amount + count)
-- in fn_refresh_ar_aging, matching the existing over_90 guard. Prevents pre_petition
-- invoices double-counting (bucket + pre_petition_amount) for any future upload where
-- a pre_petition invoice has positive days_overdue. Verified no-op on current data
-- (B0 set pre_petition days_overdue=0): buckets identical, per-customer reconciliation 0.
-- Definition-only change; does not re-run snapshots (guard produces identical output).

CREATE OR REPLACE FUNCTION public.fn_refresh_ar_aging(p_customer_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cur BIGINT; v_b1  BIGINT; v_b2 BIGINT; v_b3 BIGINT; v_b4 BIGINT; v_pp BIGINT;
  v_cc  INT;    v_c1  INT;    v_c2 INT;    v_c3 INT;    v_c4 INT;
  v_lim BIGINT; v_util NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(amount_outstanding) FILTER (WHERE days_overdue = 0 AND status = 'current'), 0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE days_overdue BETWEEN 1  AND 30 AND status != 'pre_petition'),  0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE days_overdue BETWEEN 31 AND 60 AND status != 'pre_petition'),  0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE days_overdue BETWEEN 61 AND 90 AND status != 'pre_petition'),  0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE days_overdue > 90 AND status != 'pre_petition'), 0),
    COALESCE(SUM(amount_outstanding) FILTER (WHERE status = 'pre_petition'), 0),
    COUNT(*) FILTER (WHERE days_overdue = 0  AND status = 'current'),
    COUNT(*) FILTER (WHERE days_overdue BETWEEN 1  AND 30 AND status != 'pre_petition'),
    COUNT(*) FILTER (WHERE days_overdue BETWEEN 31 AND 60 AND status != 'pre_petition'),
    COUNT(*) FILTER (WHERE days_overdue BETWEEN 61 AND 90 AND status != 'pre_petition'),
    COUNT(*) FILTER (WHERE days_overdue > 90 AND status != 'pre_petition')
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
$function$;
