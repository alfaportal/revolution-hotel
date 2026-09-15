-- Kodet sekretë për ndërrimin e arkës (fiskale / termike) — vetëm pronari i vendos.

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS register_code_fiscal_hash TEXT,
  ADD COLUMN IF NOT EXISTS register_code_thermal_hash TEXT,
  ADD COLUMN IF NOT EXISTS active_coupon_type TEXT NOT NULL DEFAULT 'thermal',
  ADD COLUMN IF NOT EXISTS register_mode_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_active_coupon_type_check'
  ) THEN
    ALTER TABLE pos_settings
      ADD CONSTRAINT pos_settings_active_coupon_type_check
      CHECK (active_coupon_type IN ('thermal', 'fiscal'));
  END IF;
END $$;

COMMENT ON COLUMN pos_settings.register_code_fiscal_hash IS 'bcrypt hash — kod sekret për arkë fiskale';
COMMENT ON COLUMN pos_settings.register_code_thermal_hash IS 'bcrypt hash — kod sekret për arkë termike';
COMMENT ON COLUMN pos_settings.active_coupon_type IS 'Arka aktive e lokale: thermal | fiscal';
