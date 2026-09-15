-- REVOLUTION HOTEL — kategoritë brenda hotelit (Super Admin telefon)
-- Hotel, Motel, Hostel, Resort, Villë me qira.
-- Nëse projekti është BOSH (Supabase i ri), ekzekuto supabase/bootstrap_hotel.sql
-- (përfshin këto CHECK + tabelat clients/licenses). Ky file vetëm ALTER.

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
    'hotel',
    'motel',
    'hostel',
    'resort',
    'ville_me_qira',
    'ville',
    'bujtine',
    'market',
    'minimarket',
    'mini_market',
    'pilar',
    'supermarket',
    'dyqan_ushqimor',
    'manav',
    'bulmetore',
    'kasap',
    'peshkore',
    'dyqan_peshku',
    'dyqan_rroba',
    'dyqan_kepuce',
    'dyqan',
    'farmaci',
    'optike',
    'berber',
    'sallon_bukurie',
    'tjeter'
  ));
