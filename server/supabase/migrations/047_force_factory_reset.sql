-- Remote factory-reset flag: Super Admin (phone) → POS wipes local data like "Rivendos si të re"
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS force_factory_reset_at TIMESTAMPTZ;

COMMENT ON COLUMN licenses.force_factory_reset_at IS
  'When set, POS heartbeat tells desktop to factory-reset local data, then POS acks and clears this.';
