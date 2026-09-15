-- =============================================================================
-- ROLLBACK për 064_enable_rls_lockdown_anon.sql
-- Përdor VETËM nëse pas RLS diçka thyhet (s’pritet, sepse service_role bypass).
-- Vërejtje: DISABLE RLS e kthen ekspozimin e anon key — përdore si urgjencë.
-- =============================================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
    RAISE NOTICE 'RLS DISABLED: %', r.tablename;
  END LOOP;
END $$;

-- Rivendos privilegjet tipike Supabase (nëse i hove me REVOKE)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

SELECT
  COUNT(*) FILTER (WHERE c.relrowsecurity) AS tables_with_rls_still_on,
  COUNT(*) AS total_public_tables
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
