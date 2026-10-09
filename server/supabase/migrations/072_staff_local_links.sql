-- 084_staff_local_links.sql (alias në repo të plotë) — snapshot linke WiFi stafi nga desktop
ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS staff_local_links JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN pos_settings.staff_local_links IS
  'Linke LAN kamarier/recepsion — sync nga Revolution HOTEL desktop (Sinkronizo gjithçka)';
