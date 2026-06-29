-- Credit ratings for all 59 customers.
-- Three provider schemes normalised to 0-100 scale:
--   S&P / Fitch (sp_fitch): public companies — AAA=100 … D=5
--   D&B PAYDEX (dnb_paydex): private companies — raw 0-100 = normalised directly
--   Coface (coface): SME companies — raw 0-10, normalised ×10-2 (rounded)

-- ── NORMAL OPERATIONS — S&P for public companies ─────────────────────────────

UPDATE public.customers SET credit_rating_score=72, credit_rating_source='sp_fitch', credit_rating_raw='BBB+' WHERE company_name='Baker Hughes Company';
UPDATE public.customers SET credit_rating_score=62, credit_rating_source='sp_fitch', credit_rating_raw='BB+'  WHERE company_name='Chart Industries Inc';
UPDATE public.customers SET credit_rating_score=60, credit_rating_source='sp_fitch', credit_rating_raw='BB'   WHERE company_name='CIRCOR International Inc';
UPDATE public.customers SET credit_rating_score=70, credit_rating_source='sp_fitch', credit_rating_raw='BBB'  WHERE company_name='Curtiss-Wright Corporation';
UPDATE public.customers SET credit_rating_score=62, credit_rating_source='sp_fitch', credit_rating_raw='BB+'  WHERE company_name='Ducommun Incorporated';
UPDATE public.customers SET credit_rating_score=60, credit_rating_source='sp_fitch', credit_rating_raw='BB'   WHERE company_name='Haynes International Inc';
UPDATE public.customers SET credit_rating_score=78, credit_rating_source='sp_fitch', credit_rating_raw='A-'   WHERE company_name='HEICO Corporation';
UPDATE public.customers SET credit_rating_score=62, credit_rating_source='sp_fitch', credit_rating_raw='BB+'  WHERE company_name='Howmet Aerospace Inc';
UPDATE public.customers SET credit_rating_score=70, credit_rating_source='sp_fitch', credit_rating_raw='BBB'  WHERE company_name='Huntington Ingalls Industries Inc';
UPDATE public.customers SET credit_rating_score=78, credit_rating_source='sp_fitch', credit_rating_raw='A-'   WHERE company_name='Lockheed Martin Corporation';
UPDATE public.customers SET credit_rating_score=62, credit_rating_source='sp_fitch', credit_rating_raw='BB+'  WHERE company_name='Moog Inc';
UPDATE public.customers SET credit_rating_score=80, credit_rating_source='sp_fitch', credit_rating_raw='A'    WHERE company_name='Parker Hannifin Corporation';
UPDATE public.customers SET credit_rating_score=78, credit_rating_source='sp_fitch', credit_rating_raw='A-'   WHERE company_name='Precision Castparts Corp';
UPDATE public.customers SET credit_rating_score=72, credit_rating_source='sp_fitch', credit_rating_raw='BBB+' WHERE company_name='Raytheon Technologies (RTX)';
UPDATE public.customers SET credit_rating_score=52, credit_rating_source='sp_fitch', credit_rating_raw='B+'   WHERE company_name='Spirit AeroSystems Holdings Inc';
UPDATE public.customers SET credit_rating_score=62, credit_rating_source='sp_fitch', credit_rating_raw='BB+'  WHERE company_name='The Boeing Company';
UPDATE public.customers SET credit_rating_score=60, credit_rating_source='sp_fitch', credit_rating_raw='BB'   WHERE company_name='The Nordam Group LLC';
UPDATE public.customers SET credit_rating_score=52, credit_rating_source='sp_fitch', credit_rating_raw='B+'   WHERE company_name='TransDigm Group Incorporated';
UPDATE public.customers SET credit_rating_score=70, credit_rating_source='sp_fitch', credit_rating_raw='BBB'  WHERE company_name='Watts Water Technologies Inc';
UPDATE public.customers SET credit_rating_score=68, credit_rating_source='sp_fitch', credit_rating_raw='BBB-' WHERE company_name='Woodward Inc';

-- ── NORMAL OPERATIONS — D&B PAYDEX for private companies ─────────────────────

UPDATE public.customers SET credit_rating_score=80, credit_rating_source='dnb_paydex', credit_rating_raw='80' WHERE company_name='Meridian Aerospace Components';
UPDATE public.customers SET credit_rating_score=78, credit_rating_source='dnb_paydex', credit_rating_raw='78' WHERE company_name='Summit Defense Technologies';

-- ── NORMAL OPERATIONS — Coface for SME companies ─────────────────────────────

UPDATE public.customers SET credit_rating_score=78, credit_rating_source='coface', credit_rating_raw='8' WHERE company_name='Clearwater Coatings Inc';
UPDATE public.customers SET credit_rating_score=67, credit_rating_source='coface', credit_rating_raw='7' WHERE company_name='Delta Precision Parts';
UPDATE public.customers SET credit_rating_score=67, credit_rating_source='coface', credit_rating_raw='7' WHERE company_name='Pacific Rim Tooling';

-- ── GROWTH OPPORTUNITY ────────────────────────────────────────────────────────

UPDATE public.customers SET credit_rating_score=42, credit_rating_source='sp_fitch', credit_rating_raw='B-'   WHERE company_name='Archer Aviation Inc';
UPDATE public.customers SET credit_rating_score=45, credit_rating_source='sp_fitch', credit_rating_raw='B'    WHERE company_name='Bloom Energy Corporation';
UPDATE public.customers SET credit_rating_score=60, credit_rating_source='sp_fitch', credit_rating_raw='BB'   WHERE company_name='GE Vernova Inc';
UPDATE public.customers SET credit_rating_score=32, credit_rating_source='sp_fitch', credit_rating_raw='CCC+' WHERE company_name='Joby Aviation Inc';
UPDATE public.customers SET credit_rating_score=62, credit_rating_source='sp_fitch', credit_rating_raw='BB+'  WHERE company_name='Leonardo DRS Inc';

-- ── NEGATIVE NEWS ─────────────────────────────────────────────────────────────

UPDATE public.customers SET credit_rating_score=68, credit_rating_source='sp_fitch',   credit_rating_raw='BBB-' WHERE company_name='AECOM Technology Corporation';
UPDATE public.customers SET credit_rating_score=45, credit_rating_source='sp_fitch',   credit_rating_raw='B'    WHERE company_name='American Airlines Group Inc';
UPDATE public.customers SET credit_rating_score=42, credit_rating_source='sp_fitch',   credit_rating_raw='B-'   WHERE company_name='Liqtech International AS';
UPDATE public.customers SET credit_rating_score=52, credit_rating_source='sp_fitch',   credit_rating_raw='B+'   WHERE company_name='Maxar Technologies Inc';
UPDATE public.customers SET credit_rating_score=28, credit_rating_source='sp_fitch',   credit_rating_raw='CCC'  WHERE company_name='Spirit Airlines Inc';
UPDATE public.customers SET credit_rating_score=52, credit_rating_source='dnb_paydex', credit_rating_raw='52'   WHERE company_name='Northgate Fabrication';

-- ── PAYMENT ISSUES ────────────────────────────────────────────────────────────

UPDATE public.customers SET credit_rating_score=42, credit_rating_source='sp_fitch',   credit_rating_raw='B-'   WHERE company_name='Global Power Equipment Group';
UPDATE public.customers SET credit_rating_score=58, credit_rating_source='sp_fitch',   credit_rating_raw='BB-'  WHERE company_name='Kaman Corporation';
UPDATE public.customers SET credit_rating_score=45, credit_rating_source='sp_fitch',   credit_rating_raw='B'    WHERE company_name='Nordam Group - Legacy Division';
UPDATE public.customers SET credit_rating_score=32, credit_rating_source='sp_fitch',   credit_rating_raw='CCC+' WHERE company_name='Orbital Energy Group Inc';
UPDATE public.customers SET credit_rating_score=52, credit_rating_source='sp_fitch',   credit_rating_raw='B+'   WHERE company_name='ProPetro Holding Corp';
UPDATE public.customers SET credit_rating_score=45, credit_rating_source='sp_fitch',   credit_rating_raw='B'    WHERE company_name='Ranger Energy Services Inc';
UPDATE public.customers SET credit_rating_score=32, credit_rating_source='sp_fitch',   credit_rating_raw='CCC+' WHERE company_name='Vertex Energy Inc';
UPDATE public.customers SET credit_rating_score=38, credit_rating_source='dnb_paydex', credit_rating_raw='38'   WHERE company_name='Cascade Industrial Systems';
UPDATE public.customers SET credit_rating_score=22, credit_rating_source='coface',     credit_rating_raw='3'    WHERE company_name='Brixton Fasteners Ltd';
UPDATE public.customers SET credit_rating_score=33, credit_rating_source='coface',     credit_rating_raw='4'    WHERE company_name='Ironwood Machine Works';

-- ── CREDIT DETERIORATION ──────────────────────────────────────────────────────

UPDATE public.customers SET credit_rating_score=58, credit_rating_source='sp_fitch',   credit_rating_raw='BB-'  WHERE company_name='Arconic Corporation';
UPDATE public.customers SET credit_rating_score=32, credit_rating_source='dnb_paydex', credit_rating_raw='32'   WHERE company_name='Atlas Precision Manufacturing';
UPDATE public.customers SET credit_rating_score=42, credit_rating_source='sp_fitch',   credit_rating_raw='B-'   WHERE company_name='Coeur Mining Inc';
UPDATE public.customers SET credit_rating_score=60, credit_rating_source='sp_fitch',   credit_rating_raw='BB'   WHERE company_name='General Electric Company (Power segment)';
UPDATE public.customers SET credit_rating_score=28, credit_rating_source='sp_fitch',   credit_rating_raw='CCC'  WHERE company_name='McDermott International Ltd';
UPDATE public.customers SET credit_rating_score=45, credit_rating_source='sp_fitch',   credit_rating_raw='B'    WHERE company_name='Mistras Group Inc';
UPDATE public.customers SET credit_rating_score=42, credit_rating_source='sp_fitch',   credit_rating_raw='B-'   WHERE company_name='Superior Industries International Inc';
UPDATE public.customers SET credit_rating_score=32, credit_rating_source='sp_fitch',   credit_rating_raw='CCC+' WHERE company_name='Triumph Group Inc';

-- ── SEC FILING MONITORING ─────────────────────────────────────────────────────

UPDATE public.customers SET credit_rating_score=22, credit_rating_source='sp_fitch', credit_rating_raw='CCC-' WHERE company_name='Heliogen Inc';
UPDATE public.customers SET credit_rating_score=70, credit_rating_source='sp_fitch', credit_rating_raw='BBB'  WHERE company_name='Textron Inc';

-- ── BANKRUPTCY ────────────────────────────────────────────────────────────────

UPDATE public.customers SET credit_rating_score=5, credit_rating_source='sp_fitch', credit_rating_raw='D' WHERE company_name='Proterra Inc';
UPDATE public.customers SET credit_rating_score=5, credit_rating_source='sp_fitch', credit_rating_raw='D' WHERE company_name='Rite Aid Corporation';
UPDATE public.customers SET credit_rating_score=5, credit_rating_source='sp_fitch', credit_rating_raw='D' WHERE company_name='Yellow Corporation';

-- ── Verify update count ───────────────────────────────────────────────────────
DO $$
DECLARE
  updated_count integer;
BEGIN
  SELECT COUNT(*) INTO updated_count FROM public.customers WHERE credit_rating_score IS NOT NULL;
  RAISE NOTICE 'Customers with credit ratings: %', updated_count;
END;
$$;
