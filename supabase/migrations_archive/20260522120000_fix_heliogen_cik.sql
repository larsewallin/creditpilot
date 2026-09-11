-- Fix wrong Heliogen CIK in sec_monitoring and customers.
--
-- CIK 0001848948 is actually 10X Capital Venture Acquisition Corp III (a SPAC),
-- not Heliogen. Heliogen's real CIK is 0001840292, confirmed via EDGAR company
-- search (https://www.sec.gov/cgi-bin/browse-edgar?company=heliogen).

UPDATE sec_monitoring
   SET cik = '0001840292'
 WHERE customer_id = 'c0000001-0000-0000-0000-000000000049'
   AND cik = '0001848948';

UPDATE customers
   SET sec_cik = '0001840292'
 WHERE id = 'c0000001-0000-0000-0000-000000000049'
   AND sec_cik = '0001848948';
