-- Master Admin: produkti / industria e klientit (kafene | security)
-- Zero data loss — të gjithë klientët ekzistues → 'kafene'

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS product_line TEXT;

UPDATE public.clients
SET product_line = 'kafene'
WHERE product_line IS NULL OR TRIM(product_line) = '';

ALTER TABLE public.clients
  ALTER COLUMN product_line SET DEFAULT 'kafene';

ALTER TABLE public.clients
  ALTER COLUMN product_line SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_product_line_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_product_line_check
      CHECK (product_line IN ('kafene', 'security'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_product_line ON public.clients (product_line);

-- Licenca: lejo app_type 'sekurim' + product_line
ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS product_line TEXT;

UPDATE public.licenses
SET product_line = 'kafene'
WHERE product_line IS NULL OR TRIM(product_line) = '';

ALTER TABLE public.licenses
  ALTER COLUMN product_line SET DEFAULT 'kafene';

DO $$
BEGIN
  -- Hiq CHECK të vjetër app_type (emri mund të ndryshojë)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.licenses'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%app_type%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.licenses DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'public.licenses'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%app_type%'
      LIMIT 1
    );
  END IF;
END $$;

ALTER TABLE public.licenses
  DROP CONSTRAINT IF EXISTS licenses_app_type_check;

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_app_type_check
  CHECK (app_type IN ('restorant', 'kafene', 'sekurim'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'licenses_product_line_check'
  ) THEN
    ALTER TABLE public.licenses
      ADD CONSTRAINT licenses_product_line_check
      CHECK (product_line IS NULL OR product_line IN ('kafene', 'security'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_licenses_product_line ON public.licenses (product_line);

COMMENT ON COLUMN public.clients.product_line IS 'Master Admin: kafene | security';
COMMENT ON COLUMN public.licenses.product_line IS 'Master Admin: kafene | security';
COMMENT ON COLUMN public.licenses.app_type IS 'POS: restorant|kafene · Security: sekurim';

NOTIFY pgrst, 'reload schema';
