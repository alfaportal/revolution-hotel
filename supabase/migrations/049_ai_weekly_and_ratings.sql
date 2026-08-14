-- Raporte javore AI + cache vlerësimi kamarierësh (Pako 4)

CREATE TABLE IF NOT EXISTS ai_weekly_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  week_end        DATE NOT NULL,
  report_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_text    TEXT NOT NULL DEFAULT '',
  email_sent_at   TIMESTAMPTZ,
  tokens_used     INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_weekly_reports_restaurant
  ON ai_weekly_reports (restaurant_id, week_start DESC);

CREATE TABLE IF NOT EXISTS ai_waiter_ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  ratings_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  analysis_text   TEXT NOT NULL DEFAULT '',
  tokens_used     INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_ai_waiter_ratings_restaurant
  ON ai_waiter_ratings (restaurant_id, period_end DESC);

COMMENT ON TABLE ai_weekly_reports IS 'Raportet AI javore (e hënë) për klientët me Pako 4.';
COMMENT ON TABLE ai_waiter_ratings IS 'Analiza AI e refuzimeve / vlerësimit të kamarierëve.';
