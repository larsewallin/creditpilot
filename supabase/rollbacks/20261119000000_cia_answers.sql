-- Rollback for 20261119000000_cia_answers.sql. Deletes every stored CIA answer (share links stop
-- working): run only with the founder's go-ahead.
DROP TABLE IF EXISTS public.cia_answers;
