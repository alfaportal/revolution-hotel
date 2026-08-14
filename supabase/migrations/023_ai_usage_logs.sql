-- Regjistron përdorimin e AI (chat / OCR) për çdo restorant

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature_type   TEXT NOT NULL CHECK (feature_type IN ('chat', 'ocr')),
  tokens_used    INTEGER NOT NULL CHECK (tokens_used >= 0),
  cost_usd       NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_usage_logs IS 'Historiku i thirrjeve AI (chat, OCR) për llogaritje kostoje.';
COMMENT ON COLUMN ai_usage_logs.restaurant_id IS 'FK te clients.id — restoranti/kafeneja.';
COMMENT ON COLUMN ai_usage_logs.feature_type IS 'chat ose ocr';
COMMENT ON COLUMN ai_usage_logs.tokens_used IS 'Numri total i tokenëve të konsumuar.';
COMMENT ON COLUMN ai_usage_logs.cost_usd IS 'Kostoja e vlerësuar në USD për këtë thirrje.';

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_restaurant_created
  ON ai_usage_logs (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature_created
  ON ai_usage_logs (feature_type, created_at DESC);
