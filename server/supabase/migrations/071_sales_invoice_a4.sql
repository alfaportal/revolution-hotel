-- Fatura A4 shitje (panel pronari) — numri i radhës + logo + TVSH faturë

BEGIN;

CREATE TABLE IF NOT EXISTS public.invoice_sequence (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, year)
);

ALTER TABLE public.invoice_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_sequence FROM anon, authenticated;

ALTER TABLE public.pos_settings
  ADD COLUMN IF NOT EXISTS company_logo_url text,
  ADD COLUMN IF NOT EXISTS sales_invoice_vat_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_invoice_vat_percent numeric(5, 2) NOT NULL DEFAULT 18;

CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_client_id uuid, p_year int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  IF p_client_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'client_id dhe year kërkohen';
  END IF;
  INSERT INTO public.invoice_sequence (client_id, year, last_number)
  VALUES (p_client_id, p_year, 1)
  ON CONFLICT (client_id, year)
  DO UPDATE SET last_number = public.invoice_sequence.last_number + 1
  RETURNING last_number INTO n;
  RETURN p_year::text || '-' || lpad(n::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(uuid, int) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
