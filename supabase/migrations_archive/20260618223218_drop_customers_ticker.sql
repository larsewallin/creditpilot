-- ticker migration final step: drop customers.ticker.
-- Data lives in customer_identifiers (47 ticker rows, all is_primary).
-- All readers repointed: 4 agents cleaned (CIA/news/sec/AR), 7 views now LEFT JOIN customer_identifiers.
-- Drop dry-run confirmed zero remaining dependencies.

ALTER TABLE customers DROP COLUMN ticker;
