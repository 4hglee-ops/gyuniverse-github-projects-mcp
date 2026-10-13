-- M13 Preview-only admin console identity/credential store.
-- Apply AFTER M12 foundation to a dedicated Gyuniverse MCP Supabase project.
-- Do not apply to Production until security review and rollout approval.
-- No plaintext key, admin password, OAuth token, or GitHub credential enters DB.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mcp_admin_users (
  subject text PRIMARY KEY,
  display_name text NOT NULL,
  github_login text,
  role text NOT NULL CHECK (role IN ('viewer','member','admin')),
  project_ids text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_admin_subject_valid CHECK (subject ~ '^user:managed:[0-9a-f-]{36}$'),
  CONSTRAINT mcp_admin_display_name_valid CHECK (length(display_name) BETWEEN 1 AND 100),
  CONSTRAINT mcp_admin_projects_valid CHECK (cardinality(project_ids) BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS public.mcp_admin_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL REFERENCES public.mcp_admin_users(subject) ON DELETE RESTRICT,
  secret_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  revoked_at timestamptz,
  CONSTRAINT mcp_admin_secret_hash_valid CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mcp_admin_expiration_valid CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS mcp_admin_credentials_active
  ON public.mcp_admin_credentials(subject) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.mcp_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL DEFAULT 'console-admin',
  action text NOT NULL,
  subject text,
  credential_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_admin_audit_recent ON public.mcp_admin_audit(created_at DESC);

ALTER TABLE public.mcp_admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_admin_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_admin_users, public.mcp_admin_credentials, public.mcp_admin_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.mcp_admin_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mcp_admin_users, public.mcp_admin_credentials TO service_role;
GRANT SELECT, INSERT ON public.mcp_admin_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mcp_admin_audit_id_seq TO service_role;

-- All functions are SECURITY INVOKER, restricted to the backend's service role.
CREATE OR REPLACE FUNCTION public.mcp_admin_create_user(
  p_display_name text, p_github_login text, p_role text, p_project_ids text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_subject text; v_projects text[];
BEGIN
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 100
    OR p_role NOT IN ('viewer','member','admin')
    OR p_project_ids IS NULL OR cardinality(p_project_ids) NOT BETWEEN 1 AND 30
    OR EXISTS (SELECT 1 FROM unnest(p_project_ids) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 256)
    OR (SELECT COUNT(DISTINCT x) FROM unnest(p_project_ids) x) <> cardinality(p_project_ids)
    OR length(COALESCE(p_github_login,'')) > 100
  THEN RAISE EXCEPTION 'Invalid managed user'; END IF;
  v_subject := 'user:managed:' || gen_random_uuid()::text;
  v_projects := p_project_ids;
  INSERT INTO public.mcp_admin_users(subject,display_name,github_login,role,project_ids)
  VALUES (v_subject,btrim(p_display_name),nullif(btrim(p_github_login),''),p_role,v_projects);
  INSERT INTO public.mcp_admin_audit(action,subject) VALUES ('create_user',v_subject);
  RETURN jsonb_build_object('subject',v_subject);
END; $$;

CREATE OR REPLACE FUNCTION public.mcp_admin_set_user(
  p_subject text, p_role text, p_project_ids text[], p_enabled boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_subject IS NULL OR p_role NOT IN ('viewer','member','admin')
    OR p_project_ids IS NULL OR cardinality(p_project_ids) NOT BETWEEN 1 AND 30
    OR p_enabled IS NULL
    OR EXISTS(SELECT 1 FROM unnest(p_project_ids) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 256)
    OR (SELECT COUNT(DISTINCT x) FROM unnest(p_project_ids) x) <> cardinality(p_project_ids)
  THEN RAISE EXCEPTION 'Invalid managed user update'; END IF;
  UPDATE public.mcp_admin_users
  SET role=p_role,project_ids=p_project_ids,enabled=p_enabled,updated_at=now()
  WHERE subject=p_subject;
  IF NOT FOUND THEN RAISE EXCEPTION 'Managed user not found'; END IF;
  INSERT INTO public.mcp_admin_audit(action,subject) VALUES ('set_user',p_subject);
  RETURN jsonb_build_object('ok',true);
END; $$;

CREATE OR REPLACE FUNCTION public.mcp_admin_issue_credential(
  p_subject text, p_secret_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_secret_hash IS NULL OR p_secret_hash !~ '^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM public.mcp_admin_users WHERE subject=p_subject AND enabled)
  THEN RAISE EXCEPTION 'Invalid credential target'; END IF;
  IF (SELECT count(*) FROM public.mcp_admin_credentials
     WHERE subject=p_subject AND revoked_at IS NULL AND expires_at>now()) >= 5
  THEN RAISE EXCEPTION 'Active credential limit reached'; END IF;
  INSERT INTO public.mcp_admin_credentials(subject,secret_hash)
  VALUES(p_subject,p_secret_hash) RETURNING id INTO v_id;
  INSERT INTO public.mcp_admin_audit(action,subject,credential_id)
  VALUES('issue_credential',p_subject,v_id);
  RETURN jsonb_build_object('id',v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.mcp_admin_revoke_credential(
  p_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_subject text;
BEGIN
  UPDATE public.mcp_admin_credentials SET revoked_at=now()
  WHERE id=p_id AND revoked_at IS NULL RETURNING subject INTO v_subject;
  IF v_subject IS NULL THEN RAISE EXCEPTION 'Credential not found or already revoked'; END IF;
  INSERT INTO public.mcp_admin_audit(action,subject,credential_id)
  VALUES('revoke_credential',v_subject,p_id);
  RETURN jsonb_build_object('ok',true);
END; $$;

-- The signature returned below contains only role/membership metadata.
-- It NEVER exposes secret_hash or any stored credential.
CREATE OR REPLACE FUNCTION public.mcp_admin_resolve(
  p_hash text DEFAULT NULL, p_id uuid DEFAULT NULL, p_subject text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'credentialId',c.id,'subject',u.subject,'role',u.role,
    'projectIds',u.project_ids,'displayName',u.display_name,'githubLogin',u.github_login
  )
  FROM public.mcp_admin_credentials c
  JOIN public.mcp_admin_users u ON u.subject=c.subject
  WHERE u.enabled AND c.revoked_at IS NULL AND c.expires_at>now()
    AND ((p_hash IS NOT NULL AND p_id IS NULL AND c.secret_hash=p_hash)
      OR (p_hash IS NULL AND p_id IS NOT NULL AND c.id=p_id))
    AND (p_subject IS NULL OR u.subject=p_subject)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mcp_admin_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT jsonb_build_object(
  'users',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'subject',subject,'displayName',display_name,'githubLogin',github_login,
    'role',role,'projectIds',project_ids,'enabled',enabled,'createdAt',created_at
  ) ORDER BY created_at) FROM public.mcp_admin_users), '[]'::jsonb),
  'credentials',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id',id,'subject',subject,'createdAt',created_at,
    'expiresAt',expires_at,'revokedAt',revoked_at
  ) ORDER BY created_at DESC) FROM public.mcp_admin_credentials), '[]'::jsonb),
  'audit',COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'action',action,'subject',subject,'credentialId',credential_id,'createdAt',created_at
  ) ORDER BY created_at DESC) FROM (SELECT * FROM public.mcp_admin_audit ORDER BY created_at DESC LIMIT 40) logs), '[]'::jsonb)
 );
$$;

REVOKE ALL ON FUNCTION public.mcp_admin_create_user(text,text,text,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_admin_set_user(text,text,text[],boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_admin_issue_credential(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_admin_revoke_credential(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_admin_resolve(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_admin_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_admin_create_user(text,text,text,text[]),
  public.mcp_admin_set_user(text,text,text[],boolean),
  public.mcp_admin_issue_credential(text,text),
  public.mcp_admin_revoke_credential(uuid),
  public.mcp_admin_resolve(text,uuid,text),
  public.mcp_admin_overview() TO service_role;

COMMIT;
