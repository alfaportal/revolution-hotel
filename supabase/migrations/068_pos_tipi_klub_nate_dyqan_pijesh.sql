-- REVOLUTION POS — tipet e reja për regjistrim (klub nate, dyqan pijesh)
-- Tipet e vjetra mbeten të lejuara (klientë ekzistues).

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_tipi_check;

ALTER TABLE public.clients ADD CONSTRAINT clients_tipi_check
  CHECK (tipi IN (
    'kafene',
    'restorant',
    'bar',
    'klub_nate',
    'piceri',
    'fast_food',
    'dyqan_pijesh',
    'pub_lounge',
    'bar_nate',
    'klub',
    'diskoteke',
    'kebab',
    'pasticeri',
    'akullore',
    'gjeltore',
    'furre_buke',
    'hotel_restorant',
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
