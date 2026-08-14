-- Faza 8 — Asistent virtual AI (historia e bisedës, pako_5)

CREATE TABLE IF NOT EXISTS ai_chat_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  tokens_used     INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_history_restaurant_created
  ON ai_chat_history (restaurant_id, created_at DESC);

COMMENT ON TABLE ai_chat_history IS 'Historia e bisedës me Asistentin AI (owner panel, pako_5)';
