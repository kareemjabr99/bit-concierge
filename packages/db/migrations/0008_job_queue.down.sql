-- Drops the queue with every job in it. Jobs carry ids only, and every one
-- of them points at a row that still says what was owed (an escalation still
-- 'pending'), so nothing is lost that the rows cannot rebuild.
DROP SCHEMA IF EXISTS pgboss CASCADE;
