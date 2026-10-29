-- 20261029000000_application_assignees.sql
--
-- New Customer Onboarding, batch 4: who owns each application.
-- credit_assignee: the credit analyst or manager working it.
-- sales_assignee:  the sales rep for the account.
-- Set through the onboarding function (submit defaults the submitter;
-- the "assign" action changes them). No new access rules: signed-in users
-- already read credit_applications; writes stay service-role only.

ALTER TABLE public.credit_applications
  ADD COLUMN credit_assignee uuid REFERENCES auth.users(id),
  ADD COLUMN sales_assignee  uuid REFERENCES auth.users(id);
