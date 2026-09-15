-- Meta pajisjeje POS — hostname, IP, aktivizimi, gabimet e validimit

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS device_hostname TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_ip TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_validation_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_validation_error TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_licenses_last_activated ON licenses (last_activated_at DESC NULLS LAST);

COMMENT ON COLUMN licenses.device_hostname IS 'Emri i kompjuterit (hostname) nga POS';
COMMENT ON COLUMN licenses.last_activated_at IS 'Koha e aktivizimit/validimit të suksesshëm të fundit';
COMMENT ON COLUMN licenses.last_ip IS 'IP e fundit e raportuar nga POS';
COMMENT ON COLUMN licenses.last_validation_error IS 'Gabimi i fundit i validimit (p.sh. DEVICE_MISMATCH)';
