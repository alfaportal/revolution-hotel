-- Tipi i aplikacionit POS për çdo liçencë (restorant / kafene)
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS app_type TEXT NOT NULL DEFAULT 'restorant'
  CHECK (app_type IN ('restorant', 'kafene'));

CREATE INDEX IF NOT EXISTS idx_licenses_app_type ON licenses (app_type);

-- Mbush nga tipi i klientit për liçensat ekzistuese
UPDATE licenses l
SET app_type = c.tipi
FROM clients c
WHERE l.client_id = c.id
  AND c.tipi IN ('restorant', 'kafene');

COMMENT ON COLUMN licenses.app_type IS 'Aplikacioni POS: restorant ose kafene';
