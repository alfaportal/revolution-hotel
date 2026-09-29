-- Numri i arkave (kasa) — vendoset vetëm nga Super Admin; default 1
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS max_registers integer NOT NULL DEFAULT 1;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_max_registers_check;
ALTER TABLE clients
  ADD CONSTRAINT clients_max_registers_check
  CHECK (max_registers >= 1 AND max_registers <= 10);

COMMENT ON COLUMN clients.max_registers IS 'Maks. arka POS për klientin (1–10); klienti nuk shton vetë.';
