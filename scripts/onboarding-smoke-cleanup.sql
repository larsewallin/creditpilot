-- Removes everything created by scripts/onboarding-smoke.mjs and onboarding-decide-smoke.mjs:
-- customers the onboarding function created (prospect, active or declined), with their
-- applications, screening, scores, baselines, proposals, credit actions and events.
-- Matches only customers whose notes say onboarding created them.
CREATE TEMP TABLE smoke_customers AS
  SELECT id FROM customers WHERE notes = 'Prospect created by onboarding';
DELETE FROM agent_runs WHERE triggered_by = 'onboarding'
  AND id IN (SELECT run_id FROM pending_actions WHERE customer_id IN (SELECT id FROM smoke_customers));
DELETE FROM credit_events WHERE customer_id IN (SELECT id FROM smoke_customers);
DELETE FROM pending_actions WHERE customer_id IN (SELECT id FROM smoke_customers);
DELETE FROM credit_actions WHERE customer_id IN (SELECT id FROM smoke_customers);
DELETE FROM underwriting_baseline WHERE customer_id IN (SELECT id FROM smoke_customers);
DELETE FROM customer_identifiers WHERE customer_id IN (SELECT id FROM smoke_customers);
DELETE FROM customers WHERE id IN (SELECT id FROM smoke_customers);
