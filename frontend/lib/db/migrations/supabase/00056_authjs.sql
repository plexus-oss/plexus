-- Phase 4a: Auth.js foundation. Canonical users table + Auth.js session/
-- account/verification-token tables. All access via service role (the
-- custom adapter in lib/auth/adapter.ts) — no client or anon access.
--
-- users.id carries Clerk ids forward (user_...) so org_members and every
-- actor_id/created_by column keeps working untouched. New users get the
-- same user_<hex> shape from the adapter.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT        PRIMARY KEY,
  email          TEXT        NOT NULL,
  email_verified TIMESTAMPTZ,
  first_name     TEXT,
  last_name      TEXT,
  image_url      TEXT,
  -- Replaces Clerk publicMetadata.plexus_staff (lib/auth/plexus-staff.ts)
  is_staff       BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Emails are stored lowercased by the adapter/backfill; the functional
-- index makes case-collisions impossible at the DB level too.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_token TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_accounts (
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  access_token        TEXT,
  refresh_token       TEXT,
  expires_at          BIGINT,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_user_id ON auth_accounts (user_id);

CREATE TABLE IF NOT EXISTS auth_verification_tokens (
  identifier TEXT        NOT NULL,
  token      TEXT        NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_verification_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_service_role"
  ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auth_sessions_service_role"
  ON auth_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auth_accounts_service_role"
  ON auth_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auth_verification_tokens_service_role"
  ON auth_verification_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
