-- Faza 9 — Parashikim fitimi (pako_5 / Raporte AI)

ALTER TABLE ai_daily_reports
  ADD COLUMN IF NOT EXISTS profit_forecast JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN ai_daily_reports.profit_forecast IS
  'Parashikim fitimi: historiku 30 ditë, krahasim javë/muaj, forecast AI në shqip';
