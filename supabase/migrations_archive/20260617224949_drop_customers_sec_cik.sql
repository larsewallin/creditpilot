-- Drop customers.sec_cik: data already migrated to customer_identifiers (id_type='cik', 47 rows),
-- zero code readers (all .cik reads are sec_filings.cik / sec_monitoring.cik, kept by design),
-- zero view readers (the 7 ticker-referencing views do not reference sec_cik).
-- ticker is handled separately (entangled: 7 views + agents read it).
ALTER TABLE customers DROP COLUMN sec_cik;
