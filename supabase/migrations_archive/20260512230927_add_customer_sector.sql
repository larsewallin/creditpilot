-- Add canonical sector column to customers table for reliable sector-level aggregation.
-- The existing `industry` column is high-cardinality freeform text (~50 distinct values
-- for ~56 rows). `sector` provides a normalized enum suitable for group-by and filtering;
-- `industry` is preserved as the human-readable descriptor.

ALTER TABLE customers
  ADD COLUMN sector text;

-- Backfill with explicit mappings. Every existing customer is assigned to exactly one
-- sector. New rows must set this field explicitly (CHECK + NOT NULL enforced after backfill).

-- Aerospace & Defense (23)
UPDATE customers SET sector = 'Aerospace & Defense' WHERE company_name IN (
  'Atlas Precision Manufacturing',
  'Lockheed Martin Corporation',
  'Meridian Aerospace Components',
  'Raytheon Technologies (RTX)',
  'Summit Defense Technologies',
  'The Boeing Company',
  'Ducommun Incorporated',
  'Precision Castparts Corp',
  'Woodward Inc',
  'TransDigm Group Incorporated',
  'Howmet Aerospace Inc',
  'Kaman Corporation',
  'The Nordam Group LLC',
  'HEICO Corporation',
  'Nordam Group - Legacy Division',
  'Spirit AeroSystems Holdings Inc',
  'Triumph Group Inc',
  'Textron Inc',
  'American Airlines Group Inc',
  'Curtiss-Wright Corporation',
  'Leonardo DRS Inc',
  'Maxar Technologies Inc',
  'Archer Aviation Inc',
  'Joby Aviation Inc',
  'Huntington Ingalls Industries Inc',
  'Spirit Airlines Inc'
);

-- Energy (11)
UPDATE customers SET sector = 'Energy' WHERE company_name IN (
  'Bloom Energy Corporation',
  'Heliogen Inc',
  'Orbital Energy Group Inc',
  'Chart Industries Inc',
  'Baker Hughes Company',
  'Ranger Energy Services Inc',
  'ProPetro Holding Corp',
  'General Electric Company (Power segment)',
  'GE Vernova Inc',
  'Global Power Equipment Group',
  'Vertex Energy Inc'
);

-- Industrial Manufacturing (12)
UPDATE customers SET sector = 'Industrial Manufacturing' WHERE company_name IN (
  'McDermott International Ltd',
  'AECOM Technology Corporation',
  'CIRCOR International Inc',
  'Ironwood Machine Works',
  'Cascade Industrial Systems',
  'Liqtech International AS',
  'Parker Hannifin Corporation',
  'Watts Water Technologies Inc',
  'Mistras Group Inc',
  'Delta Precision Parts',
  'Pacific Rim Tooling',
  'Moog Inc'
);

-- Materials (6)
UPDATE customers SET sector = 'Materials' WHERE company_name IN (
  'Arconic Corporation',
  'Superior Industries International Inc',
  'Clearwater Coatings Inc',
  'Brixton Fasteners Ltd',
  'Northgate Fabrication',
  'Haynes International Inc'
);

-- Transportation (2)
UPDATE customers SET sector = 'Transportation' WHERE company_name IN (
  'Proterra Inc',
  'Yellow Corporation'
);

-- Mining (1)
UPDATE customers SET sector = 'Mining' WHERE company_name = 'Coeur Mining Inc';

-- Other (1)
UPDATE customers SET sector = 'Other' WHERE company_name = 'Rite Aid Corporation';

-- Verify no rows missed before locking down the column.
DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_count FROM customers WHERE sector IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % customer rows have NULL sector. Backfill mapping is incomplete.', missing_count;
  END IF;
END $$;

-- Lock down the column: NOT NULL and CHECK constraint limiting to the 7 canonical values.
ALTER TABLE customers
  ALTER COLUMN sector SET NOT NULL,
  ADD CONSTRAINT customers_sector_check CHECK (sector IN (
    'Aerospace & Defense',
    'Energy',
    'Industrial Manufacturing',
    'Materials',
    'Transportation',
    'Mining',
    'Other'
  ));

CREATE INDEX IF NOT EXISTS customers_sector_idx ON customers(sector);

COMMENT ON COLUMN customers.sector IS 'Canonical sector enum for aggregation. industry column remains as freeform descriptor.';
