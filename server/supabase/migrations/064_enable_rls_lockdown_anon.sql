-- =============================================================================
-- 064 — RLS lockdown për të gjitha tabelat public
-- =============================================================================
-- Kontekst (Revolution POS):
--   • Serveri Node (Railway) përdor VETËM SUPABASE_SERVICE_ROLE_KEY → bypass RLS
--   • Kamarier / QR / owner / admin NUK flasin direkt me Supabase (anon key);
--     të gjitha kalojnë nëpër /api/* të serverit
--   • Prandaj: ENABLE RLS + ZERO policy për anon/authenticated = e sigurt
--     dhe NUK thyen funksionalitetin ekzistues
--
-- ÇFARË BËN:
--   1) Aktivizon RLS në ÇDO tabelë të schema public (që s’e ka ende)
--   2) Heq GRANT-et e rrezikshme nga rolet anon + authenticated
--   3) NUK shton policy SELECT/INSERT publike (mbyll PostgREST për anon key)
--
-- PAS RUN: Supabase Advisor “RLS disabled” duhet të zhduket.
-- =============================================================================

-- ── 1) Lista diagnostike (para) — shfaqet në Results ─────────────────────────
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- ── 2) ENABLE RLS në të gjitha tabelat public ────────────────────────────────
DO $$
DECLARE
  r RECORD;
  enabled_count int := 0;
  skipped_count int := 0;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename, c.relrowsecurity AS already
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'           -- ordinary tables only (jo views)
      AND c.relname NOT LIKE 'pg_%'
    ORDER BY c.relname
  LOOP
    IF r.already THEN
      skipped_count := skipped_count + 1;
      RAISE NOTICE 'RLS already on: %', r.tablename;
    ELSE
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
      enabled_count := enabled_count + 1;
      RAISE NOTICE 'RLS ENABLED: %', r.tablename;
    END IF;
  END LOOP;
  RAISE NOTICE '── Done: enabled=% skipped(already)=%', enabled_count, skipped_count;
END $$;

-- ── 3) Revoke akses direkt PostgREST (anon / authenticated) ──────────────────
-- Service role / postgres vazhdojnë të kenë akses (bypass RLS + privileges).
DO $$
BEGIN
  -- Tables
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  -- Sequences (INSERT me serial/identity)
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  -- Future objects
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  RAISE NOTICE 'Revoked ALL privileges on public.* from anon + authenticated';
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Role anon/authenticated mungon në këtë DB — skip revoke';
  WHEN OTHERS THEN
    RAISE WARNING 'Revoke partial failure: %', SQLERRM;
END $$;

-- ── 4) Asnjë policy publike ──────────────────────────────────────────────────
-- Me RLS ON dhe pa policy → anon/authenticated = 0 rreshta (deny by default).
-- Service role → bypass, app funksionon si më parë.
--
-- Nëse në të ardhmen duhet akses i drejtpërdrejtë nga browser me anon key,
-- shto policy eksplicite për tabelë/kolonë (mos e hap të gjithën).

-- ── 5) Verifikim (pas) ───────────────────────────────────────────────────────
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  (
    SELECT count(*)::int
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
  ) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- Duhet: rls_enabled = true për të gjitha; policy_count zakonisht 0
-- (deny-all për anon; service_role bypass).

SELECT
  COUNT(*) FILTER (WHERE NOT c.relrowsecurity) AS tables_still_without_rls,
  COUNT(*) AS total_public_tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r';
