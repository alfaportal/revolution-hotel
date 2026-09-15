-- Sektoret e reja të biznesit për Super Admin dashboard (1–12).

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
    'furre_buke',
    'hotel_restorant',
    'bar_nate',
    'klub',
    'market',
    'minimarket',
    'dyqan_rroba',
    'dyqan_kepuce',
    'dyqan',
    'farmaci',
    'optike',
    'berber',
    'sallon_bukurie',
    'tjeter'
  ));
