-- Command palette removed: recent_commands tracked palette usage history and
-- has no other consumers.
ALTER TABLE user_settings DROP COLUMN IF EXISTS recent_commands;
