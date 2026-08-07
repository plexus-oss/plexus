-- Drop unused tables that never shipped or were replaced.
-- Removes: commands, command_policies, runs, test_sessions
--   + their exclusive enums (command_status, command_delivery_level, session_status)
--   + dead annotations.run_id column (TEXT, no FK, formerly sessions.session_id)
--
-- commands / command_policies were superseded by the in-memory gateway WS
-- relay (gateway/browser.go) — command state is never persisted to Postgres.
-- runs / test_sessions had schemas + validation stubs but no production code
-- path ever wrote to them. All TS references were removed in the same PR.

-- 1. Drop dead column on annotations (auto-drops idx_annotations_session).
--    No FK constraint exists — this was a plain TEXT correlation field.
ALTER TABLE annotations DROP COLUMN IF EXISTS run_id;

-- 2. Drop tables. No inbound FKs; order does not matter.
DROP TABLE IF EXISTS commands;
DROP TABLE IF EXISTS command_policies;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS test_sessions;

-- 3. Drop enums used only by the tables above.
DROP TYPE IF EXISTS command_status;
DROP TYPE IF EXISTS command_delivery_level;
DROP TYPE IF EXISTS session_status;
