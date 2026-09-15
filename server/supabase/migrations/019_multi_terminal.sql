-- Multi-terminal licensing: max devices per license + terminal registry

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS max_terminals INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS terminal_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS terminal_limit_grace_at TIMESTAMPTZ;

COMMENT ON COLUMN licenses.max_terminals IS 'Maximum simultaneous POS terminals for this license';
COMMENT ON COLUMN licenses.terminal_price IS 'Extra monthly cost per terminal beyond the first';
COMMENT ON COLUMN licenses.base_price IS 'Base package price for billing display';
COMMENT ON COLUMN licenses.terminal_limit_grace_at IS 'When terminal limit was first exceeded (24h grace before block)';

CREATE TABLE IF NOT EXISTS license_terminals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id         UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id          TEXT NOT NULL,
  device_hostname    TEXT NOT NULL DEFAULT '',
  last_ip            TEXT NOT NULL DEFAULT '',
  first_activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_license_terminals_license
  ON license_terminals (license_id);

CREATE INDEX IF NOT EXISTS idx_license_terminals_last_seen
  ON license_terminals (license_id, last_seen_at DESC);

-- Seed registry from legacy single device_id
INSERT INTO license_terminals (license_id, device_id, device_hostname, last_ip, first_activated_at, last_seen_at)
SELECT
  id,
  UPPER(TRIM(device_id)),
  COALESCE(device_hostname, ''),
  COALESCE(last_ip, ''),
  COALESCE(last_activated_at, now()),
  COALESCE(last_validation_at, last_activated_at, now())
FROM licenses
WHERE TRIM(COALESCE(device_id, '')) <> ''
ON CONFLICT (license_id, device_id) DO NOTHING;
