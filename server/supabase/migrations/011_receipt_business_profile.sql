-- Profili i biznesit për fatura termale (header, NUI, TVSH)

ALTER TABLE pos_settings
  ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS nui TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS tvsh_nr TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS receipt_width_mm INTEGER NOT NULL DEFAULT 80;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_settings_receipt_width_mm_check'
  ) THEN
    ALTER TABLE pos_settings
      ADD CONSTRAINT pos_settings_receipt_width_mm_check
      CHECK (receipt_width_mm IN (58, 80));
  END IF;
END $$;

-- Klientët ekzistues — kopjo emër/adresë/telefon nga clients
UPDATE pos_settings ps
SET
  restaurant_name = COALESCE(NULLIF(ps.restaurant_name, ''), c.emri),
  address = COALESCE(NULLIF(ps.address, ''), c.adresa, ''),
  phone = COALESCE(NULLIF(ps.phone, ''), c.telefoni, '')
FROM clients c
WHERE ps.client_id = c.id;

-- Klientë pa pos_settings — krijo rresht default
INSERT INTO pos_settings (client_id, restaurant_name, address, phone, table_count, synced_at)
SELECT c.id, c.emri, COALESCE(c.adresa, ''), COALESCE(c.telefoni, ''), 10, now()
FROM clients c
WHERE NOT EXISTS (SELECT 1 FROM pos_settings ps WHERE ps.client_id = c.id);
