-- Public restaurant page (/r/:slug) — owner-configurable profile fields

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_description TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_hours JSONB NOT NULL DEFAULT '{}';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_logo TEXT NOT NULL DEFAULT '';

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS public_theme_color TEXT NOT NULL DEFAULT '#c2410c';

COMMENT ON COLUMN pos_settings.public_enabled IS 'When false, /r/:slug returns not found';
COMMENT ON COLUMN pos_settings.public_description IS 'Short about text on public restaurant page';
COMMENT ON COLUMN pos_settings.public_hours IS 'Opening hours JSON keyed by mon..sun';
COMMENT ON COLUMN pos_settings.public_logo IS 'Logo as data URL (base64) for PWA icon and header';
