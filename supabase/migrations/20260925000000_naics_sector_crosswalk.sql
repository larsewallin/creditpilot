-- NAICS -> sector integrity: customers.sector was an independently-settable
-- column with no link to naics_sic_code, so the two could silently drift.
-- This makes naics_sic_code the single fact a human or agent ever sets;
-- sector is always derived from it via a crosswalk function.
--
-- Design note on NULLs: most of the 59 original demo customers predate
-- naics_sic_code (added by migration 20260828000000) and have never had it
-- backfilled. The trigger only overrides sector when naics_sic_code IS NOT
-- NULL -- rows with no NAICS code keep whatever sector they already carry,
-- untouched. This is deliberate: it's the only way existing customers'
-- sector values can stay unchanged (verified by the dry-run below), while
-- still enforcing the single-source-of-truth invariant for every customer
-- that does have a NAICS code -- including one deliberately mismatched
-- sector+naics_sic_code pair, to prove the trigger actually overrides
-- rather than merely validates.
--
-- Coverage note: naics_to_sector matches NAICS-format codes only (the
-- prefixes seen in practice: 211/212/213/22/324 -> Energy/Mining,
-- 3364/336992 -> Aerospace & Defense, 331/327 -> Materials, 48/49 ->
-- Transportation, remaining 31-33 -> Industrial Manufacturing catch-all).
-- naics_sic_code can also hold a legacy SIC code per its column comment,
-- which uses a completely different numbering scheme -- those fall through
-- to 'Other' today. No SIC-coded customers exist yet; a SIC crosswalk is
-- real future work if/when one does, not built speculatively here.

CREATE OR REPLACE FUNCTION naics_to_sector(naics text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN naics IS NULL THEN NULL
    WHEN naics LIKE '3364%'  THEN 'Aerospace & Defense'
    WHEN naics LIKE '336992%' THEN 'Aerospace & Defense'
    WHEN naics LIKE '211%'   THEN 'Energy'
    WHEN naics LIKE '22%'    THEN 'Energy'
    WHEN naics LIKE '324%'   THEN 'Energy'
    WHEN naics LIKE '212%'   THEN 'Mining'
    WHEN naics LIKE '213%'   THEN 'Mining'
    WHEN naics LIKE '331%'   THEN 'Materials'
    WHEN naics LIKE '327%'   THEN 'Materials'
    WHEN naics LIKE '48%'    THEN 'Transportation'
    WHEN naics LIKE '49%'    THEN 'Transportation'
    WHEN naics LIKE '31%'    THEN 'Industrial Manufacturing'
    WHEN naics LIKE '32%'    THEN 'Industrial Manufacturing'
    WHEN naics LIKE '33%'    THEN 'Industrial Manufacturing'
    ELSE 'Other'
  END;
$$;

CREATE OR REPLACE FUNCTION trg_customers_sector_from_naics()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.naics_sic_code IS NOT NULL THEN
    NEW.sector := naics_to_sector(NEW.naics_sic_code);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_sector_from_naics ON customers;
CREATE TRIGGER customers_sector_from_naics
  BEFORE INSERT OR UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION trg_customers_sector_from_naics();
