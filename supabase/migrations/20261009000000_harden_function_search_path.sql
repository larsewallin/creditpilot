CREATE OR REPLACE FUNCTION public.fn_refresh_all_ar_aging(p_as_of date DEFAULT CURRENT_DATE) RETURNS integer
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

CREATE OR REPLACE FUNCTION public.fn_trg_recalculate_exposure() RETURNS trigger
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
