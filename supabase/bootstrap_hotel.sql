-- Revolution HOTEL — skema e re (Supabase i ndarë).
-- Përfshin migrimin 070 (Hotel / Motel / Hostel / Resort / Villë me qira).
-- Ekzekuto në SQL Editor të projektit HOTEL (mnzmbgaqtdxrtutfjesr) — JO te POS.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emri          TEXT NOT NULL,
  adresa        TEXT DEFAULT '',
  telefoni      TEXT DEFAULT '',
  email         TEXT DEFAULT '',
  tipi          TEXT NOT NULL DEFAULT 'hotel',
  kitchen_slug  TEXT,
  kitchen_key   TEXT,
  package_tier  TEXT NOT NULL DEFAULT 'pako_1',
  product_line  TEXT NOT NULL DEFAULT 'hotel',
  aktiv         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_tipi_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_tipi_check
  CHECK (tipi IN (
    'kafene','restorant','bar','klub_nate','piceri','fast_food','dyqan_pijesh',
    'pub_lounge','bar_nate','klub','diskoteke','kebab','pasticeri','akullore',
    'gjeltore','furre_buke','hotel_restorant',
    'hotel','motel','hostel','resort','ville_me_qira','ville','bujtine',
    'market','minimarket','mini_market','pilar','supermarket','dyqan_ushqimor',
    'manav','bulmetore','kasap','peshkore','dyqan_peshku',
    'dyqan_rroba','dyqan_kepuce','dyqan','farmaci','optike','berber',
    'sallon_bukurie','tjeter'
  ));

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_package_tier_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_package_tier_check
  CHECK (package_tier IN ('pako_1','pako_2','pako_3','pako_4','pako_5'));

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_product_line_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_product_line_check
  CHECK (product_line IN ('hotel'));

CREATE TABLE IF NOT EXISTS public.licenses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  app_type                TEXT NOT NULL DEFAULT 'restorant',
  product_line            TEXT NOT NULL DEFAULT 'hotel',
  device_id               TEXT DEFAULT '',
  device_hostname         TEXT DEFAULT '',
  hardware_id             TEXT NOT NULL DEFAULT '',
  last_activated_at       TIMESTAMPTZ,
  last_ip                 TEXT DEFAULT '',
  last_validation_at      TIMESTAMPTZ,
  last_validation_error   TEXT DEFAULT '',
  celesi                  TEXT NOT NULL UNIQUE,
  statusi                 TEXT NOT NULL DEFAULT 'aktive'
                          CHECK (statusi IN ('aktive','skaduar','revokuar','pezulluar')),
  data_fillimit           DATE NOT NULL DEFAULT CURRENT_DATE,
  data_skadimit           DATE NOT NULL,
  trial_ends_at           TIMESTAMPTZ,
  force_factory_reset_at  TIMESTAMPTZ,
  max_terminals           INTEGER NOT NULL DEFAULT 1,
  terminal_price          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  base_price              NUMERIC(12, 2) NOT NULL DEFAULT 0,
  terminal_limit_grace_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.licenses DROP CONSTRAINT IF EXISTS licenses_app_type_check;
ALTER TABLE public.licenses ADD CONSTRAINT licenses_app_type_check
  CHECK (app_type IN ('restorant','kafene','sekurim','market'));

CREATE TABLE IF NOT EXISTS public.license_terminals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id         UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  device_id          TEXT NOT NULL,
  device_hostname    TEXT NOT NULL DEFAULT '',
  last_ip            TEXT NOT NULL DEFAULT '',
  first_activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, device_id)
);

CREATE TABLE IF NOT EXISTS public.users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  emri              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  passwordi         TEXT,
  invite_token      TEXT,
  invite_expires_at TIMESTAMPTZ,
  password_set_at   TIMESTAMPTZ,
  roli              TEXT NOT NULL DEFAULT 'client_admin'
                    CHECK (roli IN ('super_admin','client_admin')),
  aktiv             BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_emri ON public.clients (emri);
CREATE INDEX IF NOT EXISTS idx_clients_tipi ON public.clients (tipi);
CREATE INDEX IF NOT EXISTS idx_licenses_client ON public.licenses (client_id);
CREATE INDEX IF NOT EXISTS idx_licenses_celesi ON public.licenses (celesi);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON public.licenses (statusi);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.clients, public.licenses, public.license_terminals, public.users
  TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
