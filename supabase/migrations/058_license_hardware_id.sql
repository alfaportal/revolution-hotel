-- Hardware ID 16 hex (për LICENSE_KEY) — ndryshe nga device_id 12 (terminale/cloud).
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS hardware_id TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN licenses.hardware_id IS
  'HARDWARE_ID 16 hex (XXXX-XXXX-XXXX-XXXX) nga POS Aktivizo — për gjenerim LICENSE_KEY. Jo device_id 12.';
