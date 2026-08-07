-- Add optional visualization config to event monitors
-- Stores panel_type + panel_config for rendering inside alert detail views
ALTER TABLE event_monitors ADD COLUMN visualization JSONB DEFAULT NULL;
