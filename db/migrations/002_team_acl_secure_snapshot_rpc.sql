-- M12 database read path for Supabase PostgREST.
-- Apply only to a dedicated Gyuniverse MCP project after 001_team_acl_foundation.sql.
-- No token, OAuth code or secret value is stored in these tables.

BEGIN;

-- Public schema is exposed by Supabase's data API. Deny direct access to
-- sensitive authorization tables even when a client knows their names.
ALTER TABLE public.team_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.team_principals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.teams FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.team_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.team_resources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.resource_grants FROM PUBLIC, anon, authenticated;

-- The trusted backend alone uses the service_role key, which bypasses RLS.
GRANT SELECT ON public.team_principals, public.teams, public.team_members,
  public.provider_connections, public.team_resources, public.resource_grants
TO service_role;

-- This function intentionally returns only authorization metadata. It does
-- not expose credential_ref, access codes, OAuth tokens or connection secrets.
CREATE OR REPLACE FUNCTION public.get_team_access_snapshot(p_subject text)
RETURNS TABLE (
  "teamId" text,
  "resourceId" text,
  "provider" text,
  "externalResourceId" text,
  "teamRole" text,
  "grantRole" text,
  "permissions" text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    tm.team_id::text,
    tr.id::text,
    tr.provider::text,
    tr.external_resource_id::text,
    tm.role::text,
    rg.role::text,
    rg.permissions::text[]
  FROM public.team_principals AS tp
  INNER JOIN public.team_members AS tm
    ON tm.principal_id = tp.id
    AND tm.active = true
  INNER JOIN public.resource_grants AS rg
    ON rg.team_id = tm.team_id
    AND rg.principal_id = tp.id
  INNER JOIN public.team_resources AS tr
    ON tr.team_id = rg.team_id
    AND tr.id = rg.resource_id
    AND tr.enabled = true
  INNER JOIN public.provider_connections AS pc
    ON pc.team_id = tr.team_id
    AND pc.id = tr.connection_id
    AND pc.enabled = true
    AND pc.provider = tr.provider
  WHERE tp.id = p_subject AND tp.active = true
  ORDER BY tm.team_id, tr.id;
$function$;

REVOKE ALL ON FUNCTION public.get_team_access_snapshot(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_access_snapshot(text) TO service_role;

COMMIT;
