-- Rename sessions table to runs
-- This is a mechanical rename with no functional changes.
-- Does NOT touch test_sessions (separate entity).
-- Does NOT touch dashboard_views.session_id (browser session tracking, unrelated).

-- Rename the table
ALTER TABLE sessions RENAME TO runs;

-- Rename the session_id column to run_id
ALTER TABLE runs RENAME COLUMN session_id TO run_id;

-- Rename the foreign key column in annotations
ALTER TABLE annotations RENAME COLUMN session_id TO run_id;

