-- Zgjero clients.tipi: bar, market + llojet ekzistuese.
-- Kafene / Restorant / Bar / Market / Dyqan / Tjetër — e njëjta app.

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tipi_check;

ALTER TABLE clients ADD CONSTRAINT clients_tipi_check
  CHECK (tipi IN ('restorant', 'kafene', 'tjeter', 'dyqan', 'bar', 'market'));
