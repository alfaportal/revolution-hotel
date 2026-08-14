-- Njoftime sigurie nga KAFENE (licence fail / DevTools / urgent)
CREATE TABLE IF NOT EXISTS license_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  hardware_id TEXT NOT NULL DEFAULT '',
  count_24h INTEGER NOT NULL DEFAULT 0,
  urgent BOOLEAN NOT NULL DEFAULT false,
  attempt_key_hash TEXT,
  app_version TEXT,
  hostname TEXT,
  platform TEXT,
  build_fingerprint TEXT,
  watermark_ok BOOLEAN,
  message TEXT,
  payload_json JSONB,
  client_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_security_hw_created
  ON license_security_events (hardware_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_license_security_type_created
  ON license_security_events (event_type, created_at DESC);
