-- Pakot SaaS, trial, kitchen access, login fail count në DB

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS package_tier TEXT;

-- Klientët ekzistues marrin Pako 2 (mos blloko KDS/kamarier që përdoret tashmë)
UPDATE clients SET package_tier = 'pako_2' WHERE package_tier IS NULL;

ALTER TABLE clients
  ALTER COLUMN package_tier SET DEFAULT 'pako_1';

ALTER TABLE clients
  ALTER COLUMN package_tier SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_package_tier_check'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_package_tier_check
      CHECK (package_tier IN ('pako_1', 'pako_1_1', 'pako_2', 'pako_2_1'));
  END IF;
END $$;

-- Kitchen access për klientët pa slug/key
UPDATE clients
SET kitchen_key = encode(gen_random_bytes(24), 'hex')
WHERE kitchen_key IS NULL OR kitchen_key = '';

UPDATE clients c
SET kitchen_slug = 'loc-' || substr(replace(c.id::text, '-', ''), 1, 10)
WHERE kitchen_slug IS NULL OR kitchen_slug = '';

CREATE INDEX IF NOT EXISTS idx_clients_package_tier ON clients (package_tier);

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_licenses_trial_ends ON licenses (trial_ends_at);

-- Numërim gabimesh login pronar (persistente, jo in-memory)
CREATE TABLE IF NOT EXISTS owner_login_failures (
  email             TEXT PRIMARY KEY,
  fail_count        INTEGER NOT NULL DEFAULT 0,
  window_expires_at TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_login_failures_window
  ON owner_login_failures (window_expires_at);
