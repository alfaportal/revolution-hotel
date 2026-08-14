-- Raporte AI ditore për klientët me pako_5 (Pako 4 — AI Profesionale)

CREATE TABLE IF NOT EXISTS ai_daily_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  report_date     DATE NOT NULL,
  report_json     JSONB NOT NULL DEFAULT '{}',
  summary_text    TEXT NOT NULL DEFAULT '',
  email_sent_at   TIMESTAMPTZ,
  tokens_used     INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_ai_daily_reports_restaurant_date
  ON ai_daily_reports (restaurant_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_ai_daily_reports_date
  ON ai_daily_reports (report_date DESC);

COMMENT ON TABLE ai_daily_reports IS 'Raportet AI ditore të gjeneruara automatikisht për restorantet me pako_5.';
COMMENT ON COLUMN ai_daily_reports.report_json IS 'Të dhënat e strukturuara: shitje, top artikuj, stok i ulët, fitim.';
COMMENT ON COLUMN ai_daily_reports.summary_text IS 'Përmbledhja në shqip e shkruar nga AI.';
