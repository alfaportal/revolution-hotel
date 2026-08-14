-- Night bar / Diskotekë — regjistrim nga Master Admin (sektori nightlife)
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_tipi_check;

ALTER TABLE public.clients ADD CONSTRAINT clients_tipi_check
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
    'diskoteke',
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

COMMENT ON CONSTRAINT clients_tipi_check ON public.clients IS
  'Tipet e biznesit POS — përfshirë bar_nate, klub, diskoteke';
