-- Removes prospects created by scripts/onboarding-smoke.mjs (applications, screening, scores cascade).
-- Only touches prospects whose notes say they were created by onboarding.
DELETE FROM credit_events WHERE source_agent = 'onboarding'
  AND customer_id IN (SELECT id FROM customers WHERE lifecycle_status = 'prospect' AND notes = 'Prospect created by onboarding');
DELETE FROM customer_identifiers WHERE customer_id IN (SELECT id FROM customers WHERE lifecycle_status = 'prospect' AND notes = 'Prospect created by onboarding');
DELETE FROM customers WHERE lifecycle_status = 'prospect' AND notes = 'Prospect created by onboarding';
