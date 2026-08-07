-- The recorder now receives the API key via push (POST /start) instead of
-- polling the DB, so the raw key no longer needs to be persisted.
-- gateway_api_key_id is retained for cleanupGatewayKey on session completion.
ALTER TABLE recordings DROP COLUMN gateway_api_key;
