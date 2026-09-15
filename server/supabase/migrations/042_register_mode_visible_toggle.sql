-- Zëvendëson kodet sekrete të ndërrimit të arkës (041) me një modalitet të
-- dukshëm ("auto" | "thermal" | "fiscal"), ndryshuar vetëm nga pronari te
-- paneli i tij, me gjurmë (kush/kur). Heq kolonat e kodeve — nuk përdoren më.

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS register_mode_updated_by TEXT;

ALTER TABLE pos_settings DROP CONSTRAINT IF EXISTS pos_settings_active_coupon_type_check;
ALTER TABLE pos_settings
  ADD CONSTRAINT pos_settings_active_coupon_type_check
  CHECK (active_coupon_type IN ('auto', 'thermal', 'fiscal'));

ALTER TABLE pos_settings ALTER COLUMN active_coupon_type SET DEFAULT 'auto';

ALTER TABLE pos_settings
  DROP COLUMN IF EXISTS register_code_fiscal_hash,
  DROP COLUMN IF EXISTS register_code_thermal_hash;

COMMENT ON COLUMN pos_settings.active_coupon_type IS
  'Arka aktive: auto (kamarieri zgjedh) | thermal | fiscal — ndryshuar vetëm nga pronari, në mënyrë të dukshme.';
COMMENT ON COLUMN pos_settings.register_mode_updated_by IS
  'Email i pronarit që ndryshoi modalitetin e fundit.';
