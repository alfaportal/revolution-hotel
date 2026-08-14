-- Lloje hospitality për clients.tipi (paneli Super Admin).
-- Mban edhe vlerat e vjetra (market, dyqan, tjeter) për rreshta ekzistues.

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tipi_check;

ALTER TABLE clients ADD CONSTRAINT clients_tipi_check
  CHECK (tipi IN (
    'kafene',
    'restorant',
    'bar',
    'pub_lounge',
    'piceri',
    'fast_food',
    'kebab',
    'pasticeri',
    'akullore',
    'gjeltore',
    'market',
    'dyqan',
    'tjeter'
  ));
