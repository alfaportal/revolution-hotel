-- Klient aktiv/joaktiv (Master Admin)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS aktiv BOOLEAN DEFAULT true;

UPDATE public.clients
SET aktiv = true
WHERE aktiv IS NULL;

ALTER TABLE public.clients
  ALTER COLUMN aktiv SET DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_clients_aktiv ON public.clients (aktiv);

COMMENT ON COLUMN public.clients.aktiv IS 'false = klienti i çaktivizuar në Master Admin';

NOTIFY pgrst, 'reload schema';
