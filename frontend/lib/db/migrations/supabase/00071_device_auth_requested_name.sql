-- Coding-agent key-claim flow: the agent may request a display name for the
-- key it is claiming, so the approve page can show what is asking and the
-- minted key is labeled in the API-keys list.
ALTER TABLE device_auth_requests ADD COLUMN requested_name TEXT;
