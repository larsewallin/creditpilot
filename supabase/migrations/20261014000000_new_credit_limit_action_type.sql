-- 20261014000000_new_credit_limit_action_type.sql
--
-- New Customer Onboarding, Phase 1 batch 3: a first credit limit for a new
-- customer is recorded in credit_actions as NEW_CREDIT_LIMIT (founder decision
-- 2026-10-10: one approval path through pending_actions, no separate table).
-- Kept in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.

ALTER TYPE public.credit_action_type ADD VALUE IF NOT EXISTS 'NEW_CREDIT_LIMIT';
