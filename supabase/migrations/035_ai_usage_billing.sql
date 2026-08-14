-- AI usage billing: feature granular, cost_eur, limit mujor tokenësh per klient

ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS feature TEXT;
ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cost_eur NUMERIC(12, 6);

UPDATE ai_usage_logs
SET feature = CASE
  WHEN feature_type = 'ocr' THEN 'scan_menu'
  WHEN feature_type = 'chat' THEN 'chat'
  ELSE 'chat'
END
WHERE feature IS NULL;

UPDATE ai_usage_logs
SET cost_eur = ROUND(COALESCE(cost_usd, 0) * 0.92, 6)
WHERE cost_eur IS NULL;

ALTER TABLE ai_usage_logs ALTER COLUMN feature SET DEFAULT 'chat';

ALTER TABLE ai_usage_logs DROP CONSTRAINT IF EXISTS ai_usage_logs_feature_check;
ALTER TABLE ai_usage_logs ADD CONSTRAINT ai_usage_logs_feature_check CHECK (
  feature IN (
    'scan_menu',
    'scan_invoice',
    'daily_report',
    'chat',
    'supply_suggestion',
    'profit_forecast'
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_feature_created
  ON ai_usage_logs (feature, created_at DESC);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS ai_monthly_token_limit INTEGER
  CHECK (ai_monthly_token_limit IS NULL OR ai_monthly_token_limit >= 0);

COMMENT ON COLUMN ai_usage_logs.feature IS
  'Veçoria AI: scan_menu, scan_invoice, daily_report, chat, supply_suggestion, profit_forecast';
COMMENT ON COLUMN ai_usage_logs.cost_eur IS 'Kostoja e vlerësuar në EUR (Anthropic).';
COMMENT ON COLUMN clients.ai_monthly_token_limit IS
  'Limit opsional mujor tokenësh AI; NULL = pa limit.';
