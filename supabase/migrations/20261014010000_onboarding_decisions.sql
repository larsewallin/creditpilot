-- 20261014010000_onboarding_decisions.sql
--
-- New Customer Onboarding, Phase 1 batch 3.
--
-- 1. pending_actions gets what a NEW_CREDIT_LIMIT proposal carries: the
--    application it came from, requested / recommended / supportable amounts,
--    how the limit was bound, reason codes, conditions, the cited memo, the
--    amount actually decided and the signed-in user who decided it.
--    (reviewed_by stays a text label for the existing demo flow.)
--
-- 2. Prospects are not shown to signed-out visitors: the existing anon read
--    policies on customers, credit_events and pending_actions now exclude
--    prospect rows, onboarding events and NEW_CREDIT_LIMIT actions. All 82
--    current customers are active and no onboarding rows existed before
--    Phase 1, so the demo shows exactly what it showed before.

ALTER TABLE public.pending_actions
  ADD COLUMN application_id    uuid REFERENCES public.credit_applications(id) ON DELETE CASCADE,
  ADD COLUMN requested_value   bigint,
  ADD COLUMN recommended_value bigint,
  ADD COLUMN supportable_value bigint,
  ADD COLUMN binding_method    text,
  ADD COLUMN reason_codes      text[],
  ADD COLUMN conditions        jsonb,
  ADD COLUMN memo              jsonb,
  ADD COLUMN decided_value     bigint,
  ADD COLUMN reviewed_by_user  uuid REFERENCES auth.users(id);

CREATE INDEX pending_actions_application_idx ON public.pending_actions (application_id) WHERE application_id IS NOT NULL;

DROP POLICY anon_select ON public.pending_actions;
CREATE POLICY anon_select ON public.pending_actions FOR SELECT
  USING (auth.role() = 'anon' AND action_type <> 'NEW_CREDIT_LIMIT');

DROP POLICY anon_select_customers ON public.customers;
CREATE POLICY anon_select_customers ON public.customers FOR SELECT
  USING (auth.role() = 'anon' AND lifecycle_status = 'active');

DROP POLICY anon_select_credit_events ON public.credit_events;
CREATE POLICY anon_select_credit_events ON public.credit_events FOR SELECT TO anon
  USING (source_agent <> 'onboarding');
