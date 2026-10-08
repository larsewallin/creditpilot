-- The Country Risk page reads seed_country_risk directly (same as the Industry
-- page reads seed_industry_*). Demo seed data only: allow read-only SELECT.
CREATE POLICY seed_country_risk_read ON public.seed_country_risk
  FOR SELECT TO anon, authenticated USING (true);
