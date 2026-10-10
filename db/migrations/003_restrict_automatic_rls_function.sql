-- Supabase automatic RLS event-trigger function requires no direct API access.
-- Preserve the DDL event trigger; only remove user-callable EXECUTE grants.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
