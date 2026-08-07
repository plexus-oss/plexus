-- Terminal conversations: persist the Plexus Terminal (⌘K / /terminal) chat so
-- a session survives refresh and past conversations can be resumed.
--
-- Per-USER scope: each user sees only their own threads. The whole rendered
-- Msg[] (text + tools + panels + proposals) is stored as JSONB so the UI
-- re-hydrates exactly — InlinePanel re-fetches live data on load.

CREATE TABLE terminal_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lists are "my recent threads" — org+user, newest first.
CREATE INDEX terminal_conversations_org_user_idx
  ON terminal_conversations(org_id, user_id, updated_at DESC);

ALTER TABLE terminal_conversations ENABLE ROW LEVEL SECURITY;

-- Org isolation at the DB layer; per-user filtering is enforced in the query
-- module (and the routes always pass the authed userId).
CREATE POLICY "terminal_conversations_org_isolation" ON terminal_conversations
  FOR ALL USING (org_id = public.get_org_id());
CREATE POLICY "terminal_conversations_service_role" ON terminal_conversations
  FOR ALL TO service_role USING (true);
