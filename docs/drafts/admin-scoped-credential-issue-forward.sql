-- REVIEW DRAFT ONLY: not registered, not applied to Supabase, no enrollment data.
-- Forward dependency: verified 001/002 and PR #20's 004 schema. Never overwrite 004.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.mcp_admin_users') IS NULL OR to_regclass('public.mcp_admin_credentials') IS NULL
 OR to_regclass('public.team_principals') IS NULL OR to_regprocedure('public.get_team_access_snapshot(text)') IS NULL THEN
  RAISE EXCEPTION 'ADMIN_SCHEMA_PREREQUISITE_MISSING';
 END IF;
END $$;
ALTER TABLE public.mcp_admin_users ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN credential_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE public.mcp_admin_credentials ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN issued_role text CHECK(issued_role IN ('viewer','member','admin')),ADD COLUMN issued_project_ids text[];
ALTER TABLE public.mcp_admin_audit ADD COLUMN operation_id uuid,ADD COLUMN project_ids text[];
CREATE UNIQUE INDEX mcp_admin_audit_operation_unique ON public.mcp_admin_audit(operation_id) WHERE operation_id IS NOT NULL;
CREATE SCHEMA mcp_admin_private;
REVOKE ALL ON SCHEMA mcp_admin_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA mcp_admin_private TO service_role;
CREATE TABLE mcp_admin_private.authorities(
 subject text PRIMARY KEY REFERENCES public.team_principals(id),active boolean NOT NULL DEFAULT false,
 source text NOT NULL CHECK(source IN ('env','managed')),identity_version text,credential_id uuid REFERENCES public.mcp_admin_credentials(id),
 auth_epoch bigint NOT NULL DEFAULT 1 CHECK(auth_epoch>0),policy_digest text NOT NULL CHECK(policy_digest ~ '^[0-9a-f]{64}$'),project_ids text[] NOT NULL,
 max_grant_role text NOT NULL CHECK(max_grant_role IN ('viewer','member','admin')),
 operations text[] NOT NULL DEFAULT '{}',
 CHECK(operations <@ ARRAY['admin.credentials.issue']::text[]),
 CHECK(cardinality(project_ids) BETWEEN 1 AND 100),
 CHECK((source='env' AND identity_version IS NOT NULL AND identity_version ~ '^[A-Za-z0-9_-]{43}$' AND credential_id IS NULL)
 OR(source='managed' AND identity_version IS NULL AND credential_id IS NOT NULL))
);
CREATE TABLE mcp_admin_private.leases(
 id_hash text PRIMARY KEY CHECK(id_hash ~ '^[0-9a-f]{64}$'),subject text NOT NULL REFERENCES mcp_admin_private.authorities(subject),
 auth_epoch bigint NOT NULL,source_reference text NOT NULL,policy_digest text NOT NULL CHECK(policy_digest ~ '^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 proof_expires_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=proof_expires_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE mcp_admin_private.issue_receipts(
 operation_id uuid PRIMARY KEY,actor_subject text NOT NULL REFERENCES mcp_admin_private.authorities(subject),
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),user_subject text NOT NULL REFERENCES public.mcp_admin_users(subject),
 expected_version bigint NOT NULL,credential_id uuid NOT NULL REFERENCES public.mcp_admin_credentials(id),
 issued_role text NOT NULL,project_ids text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE mcp_admin_private.authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_admin_private.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_admin_private.issue_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA mcp_admin_private FROM PUBLIC,anon,authenticated;
GRANT SELECT ON mcp_admin_private.authorities,mcp_admin_private.leases TO service_role;
GRANT SELECT,INSERT ON mcp_admin_private.issue_receipts TO service_role;

-- Coarse management authorization gate. Auth mutations take the same lock via statement triggers.
-- This avoids granting service_role write access merely to lock read-only M12/authority rows.
CREATE FUNCTION mcp_admin_private.gate() RETURNS void LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 SELECT pg_advisory_xact_lock(1482252370,1);
$$;
CREATE FUNCTION mcp_admin_private.gate_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN PERFORM mcp_admin_private.gate();RETURN NULL;END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['team_principals','team_members','provider_connections','team_resources','resource_grants','mcp_admin_users','mcp_admin_credentials'] LOOP
  EXECUTE format('CREATE TRIGGER mcp_admin_management_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION mcp_admin_private.gate_trigger()',t);
 END LOOP;
END $$;
CREATE TRIGGER mcp_admin_management_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON mcp_admin_private.authorities FOR EACH STATEMENT EXECUTE FUNCTION mcp_admin_private.gate_trigger();
CREATE TRIGGER mcp_admin_management_gate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON mcp_admin_private.leases FOR EACH STATEMENT EXECUTE FUNCTION mcp_admin_private.gate_trigger();
CREATE FUNCTION mcp_admin_private.user_version() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 NEW.version:=OLD.version;
 IF (NEW.role,NEW.project_ids,NEW.enabled,NEW.display_name,NEW.github_login) IS DISTINCT FROM (OLD.role,OLD.project_ids,OLD.enabled,OLD.display_name,OLD.github_login) THEN
  NEW.version:=OLD.version+1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_admin_user_version BEFORE UPDATE ON public.mcp_admin_users FOR EACH ROW EXECUTE FUNCTION mcp_admin_private.user_version();
CREATE FUNCTION mcp_admin_private.credential_cap() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE u public.mcp_admin_users;
BEGIN
 PERFORM mcp_admin_private.gate();
 -- A real parent-row write also forces a stale REPEATABLE READ writer to serialize/fail.
 UPDATE public.mcp_admin_users SET credential_generation=credential_generation+1 WHERE subject=NEW.subject RETURNING * INTO u;
 IF NOT FOUND OR NOT u.enabled THEN RAISE EXCEPTION 'ADMIN_TARGET_DENIED';END IF;
 IF (SELECT count(*) FROM public.mcp_admin_credentials WHERE subject=u.subject AND revoked_at IS NULL AND expires_at>clock_timestamp())>=5 THEN
  RAISE EXCEPTION 'ADMIN_KEY_LIMIT';
 END IF;
 NEW.issued_role:=u.role;NEW.issued_project_ids:=u.project_ids;
 RETURN NEW;
END $$;
CREATE TRIGGER mcp_admin_credential_cap BEFORE INSERT ON public.mcp_admin_credentials FOR EACH ROW EXECUTE FUNCTION mcp_admin_private.credential_cap();
CREATE FUNCTION mcp_admin_private.role_rank(r text) RETURNS int LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE r WHEN 'viewer' THEN 0 WHEN 'member' THEN 1 WHEN 'admin' THEN 2 ELSE 999 END;
$$;
CREATE FUNCTION mcp_admin_private.role_permissions(r text) RETURNS text[] LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE r
 WHEN 'viewer' THEN ARRAY['project.read']
 WHEN 'member' THEN ARRAY['project.read','project.write','item.add','item.update_status','item.update_priority']
 WHEN 'admin' THEN ARRAY['project.read','project.write','project.view.write','item.add','item.create','item.assign','item.update_field','item.update_status','item.update_priority','item.relationship.write','bulk.preview','bulk.approve','bulk.apply']
 ELSE ARRAY[]::text[] END;
$$;
CREATE FUNCTION mcp_admin_private.check_issue_scope(a mcp_admin_private.authorities,ctx jsonb,projects text[],target_role text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p text;n int;r record;effective text[];server_permissions text[];needed text[];
BEGIN
 IF cardinality(projects) IS NULL OR cardinality(projects) NOT BETWEEN 1 AND 30
 OR cardinality(projects)<>(SELECT count(DISTINCT x) FROM unnest(projects)x)
 OR mcp_admin_private.role_rank(target_role)>mcp_admin_private.role_rank(a.max_grant_role) THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
 needed:=mcp_admin_private.role_permissions(target_role)||ARRAY['project.read','project.write'];
 FOREACH p IN ARRAY projects LOOP
  IF NOT p=ANY(a.project_ids) OR NOT (ctx->'projectIds') ? p THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
  server_permissions:=ARRAY(SELECT jsonb_array_elements_text(ctx->'projectPermissions'->p));
  IF NOT needed<@server_permissions THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
  n:=0;
  FOR r IN SELECT tm.role AS team_role,rg.role AS grant_role,rg.permissions,pc.external_tenant_id
   FROM public.team_principals tp JOIN public.team_members tm ON tm.principal_id=tp.id AND tm.active
   JOIN public.resource_grants rg ON rg.team_id=tm.team_id AND rg.principal_id=tp.id
   JOIN public.team_resources tr ON tr.id=rg.resource_id AND tr.team_id=rg.team_id
   JOIN public.provider_connections pc ON pc.id=tr.connection_id AND pc.team_id=tr.team_id
   WHERE tp.id=a.subject AND tp.active AND tr.external_resource_id=p AND tr.enabled AND tr.write_enabled
    AND pc.enabled AND tr.provider='github_projects' AND pc.provider=tr.provider AND tr.kind='github_project_v2'
  LOOP
   n:=n+1;
   IF n>1 OR NOT (ctx->'allowedOwners') ? lower(r.external_tenant_id) THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
   effective:=coalesce(r.permissions,mcp_admin_private.role_permissions(r.grant_role));
   IF NOT effective<@mcp_admin_private.role_permissions(r.grant_role)
    OR NOT needed<@effective OR NOT needed<@mcp_admin_private.role_permissions(r.team_role) THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
  END LOOP;
  IF n<>1 THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
 END LOOP;
END $$;
-- Shared validation runs under the same transaction gate as final writes.
CREATE FUNCTION mcp_admin_private.verified_authority(p_actor jsonb,p_require_lease boolean)
RETURNS mcp_admin_private.authorities LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE a mcp_admin_private.authorities;l mcp_admin_private.leases;k public.mcp_admin_credentials;actor_user public.mcp_admin_users;
 source_ref text;source_exp timestamptz;actor_credential_expires timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR jsonb_typeof(p_actor) IS DISTINCT FROM 'object'
 OR NOT(p_actor ?& ARRAY['subject','source','sourceReference','proofExpiresAt','leaseIdHash','authEpoch','policyDigest'])
 OR EXISTS(SELECT FROM jsonb_object_keys(p_actor)x WHERE x NOT IN ('subject','source','sourceReference','proofExpiresAt','scope','leaseIdHash','authEpoch','policyDigest','allowedOwners','projectIds','projectPermissions'))
 OR jsonb_typeof(p_actor->'authEpoch') IS DISTINCT FROM 'number' OR jsonb_typeof(p_actor->'proofExpiresAt') IS DISTINCT FROM 'number'
 OR coalesce(p_actor->>'leaseIdHash','') !~ '^[0-9a-f]{64}$' OR coalesce(p_actor->>'policyDigest','') !~ '^[0-9a-f]{64}$'
 OR jsonb_typeof(p_actor->'scope') IS DISTINCT FROM 'array' OR NOT(p_actor->'scope' ? 'projects:read' AND p_actor->'scope' ? 'projects:write')
 OR jsonb_typeof(p_actor->'allowedOwners') IS DISTINCT FROM 'array' OR jsonb_typeof(p_actor->'projectIds') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_actor->'projectPermissions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ADMIN_ACTOR_DENIED';END IF;
 source_exp:=to_timestamp((p_actor->>'proofExpiresAt')::bigint);
 PERFORM mcp_admin_private.gate();
 SELECT * INTO a FROM mcp_admin_private.authorities WHERE subject=p_actor->>'subject';
 IF NOT FOUND OR NOT a.active OR a.auth_epoch::text IS DISTINCT FROM p_actor->>'authEpoch' OR a.source IS DISTINCT FROM p_actor->>'source'
 OR a.policy_digest IS DISTINCT FROM p_actor->>'policyDigest'
 OR NOT 'admin.credentials.issue'=ANY(a.operations) OR source_exp<=clock_timestamp() THEN RAISE EXCEPTION 'ADMIN_ACTOR_DENIED';END IF;
 source_ref:=coalesce(a.identity_version,a.credential_id::text);
 IF source_ref IS DISTINCT FROM p_actor->>'sourceReference' THEN RAISE EXCEPTION 'ADMIN_ACTOR_DENIED';END IF;
 IF a.source='managed' THEN
  SELECT * INTO k FROM public.mcp_admin_credentials WHERE id=a.credential_id;actor_credential_expires:=k.expires_at;
  IF NOT FOUND OR k.subject<>a.subject OR k.revoked_at IS NOT NULL OR k.expires_at<=clock_timestamp()
   OR k.issued_role IS DISTINCT FROM 'admin' OR k.issued_project_ids IS NULL THEN RAISE EXCEPTION 'ADMIN_ACTOR_DENIED';END IF;
  SELECT * INTO actor_user FROM public.mcp_admin_users WHERE subject=a.subject;
  IF NOT FOUND OR NOT actor_user.enabled OR actor_user.role<>'admin' THEN RAISE EXCEPTION 'ADMIN_ACTOR_DENIED';END IF;
  -- A stale server resolver cannot restore a removed user scope or promote an older key.
  -- Pre-draft keys with no immutable issuance ceiling require an explicit transition; never infer one.
  a.project_ids:=ARRAY(SELECT id FROM unnest(a.project_ids) AS ids(id)
   WHERE id=ANY(actor_user.project_ids) AND id=ANY(k.issued_project_ids));
 END IF;
 IF p_require_lease THEN
 SELECT * INTO l FROM mcp_admin_private.leases WHERE id_hash=p_actor->>'leaseIdHash';
 IF NOT FOUND OR l.subject<>a.subject OR l.auth_epoch<>a.auth_epoch OR l.source_reference<>source_ref OR l.revoked_at IS NOT NULL
 OR l.policy_digest<>a.policy_digest OR l.created_at>clock_timestamp() OR l.expires_at<=clock_timestamp() OR l.proof_expires_at<>source_exp THEN RAISE EXCEPTION 'ADMIN_LEASE_DENIED';END IF;
 END IF;
 RETURN a;
END $$;
CREATE FUNCTION public.mcp_admin_issue_credential_scoped_v1(p_actor jsonb,p_request jsonb,p_candidate_hash text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE a mcp_admin_private.authorities;u public.mcp_admin_users;k public.mcp_admin_credentials;
 receipt mcp_admin_private.issue_receipts;op uuid;expected bigint;target text;digest text;is_replay boolean:=false;source_ref text;source_exp timestamptz;actor_credential_expires timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'ADMIN_RPC_ISOLATION_UNSUPPORTED';END IF;
 IF jsonb_typeof(p_actor) IS DISTINCT FROM 'object' OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_request)x WHERE x NOT IN ('operationId','subject','expectedVersion'))
 OR EXISTS(SELECT FROM jsonb_object_keys(p_actor)x WHERE x NOT IN ('subject','source','sourceReference','proofExpiresAt','scope','leaseIdHash','authEpoch','policyDigest','allowedOwners','projectIds','projectPermissions'))
 OR (p_request->>'expectedVersion') IS NULL OR (p_request->>'subject') IS NULL OR (p_request->>'operationId') IS NULL
 OR (p_actor->>'subject') IS NULL OR (p_actor->>'source') IS NULL OR (p_actor->>'sourceReference') IS NULL
 OR (p_actor->>'proofExpiresAt') IS NULL OR (p_actor->>'leaseIdHash') IS NULL OR (p_actor->>'authEpoch') IS NULL
 OR jsonb_typeof(p_actor->'scope') IS DISTINCT FROM 'array' OR NOT(p_actor->'scope' ? 'projects:read' AND p_actor->'scope' ? 'projects:write')
 OR jsonb_typeof(p_actor->'allowedOwners') IS DISTINCT FROM 'array' OR jsonb_typeof(p_actor->'projectIds') IS DISTINCT FROM 'array'
 OR jsonb_typeof(p_actor->'projectPermissions') IS DISTINCT FROM 'object'
 OR coalesce(p_candidate_hash,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ADMIN_RPC_INPUT_INVALID';END IF;
 BEGIN op:=(p_request->>'operationId')::uuid;expected:=(p_request->>'expectedVersion')::bigint;source_exp:=to_timestamp((p_actor->>'proofExpiresAt')::bigint);
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'ADMIN_RPC_INPUT_INVALID';END;
 target:=p_request->>'subject';
 IF expected<1 OR target !~ '^user:managed:[0-9a-f-]{36}$' THEN RAISE EXCEPTION 'ADMIN_RPC_INPUT_INVALID';END IF;
 BEGIN PERFORM substring(target FROM 14)::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'ADMIN_RPC_INPUT_INVALID';END;
 a:=mcp_admin_private.verified_authority(p_actor,true);
 SELECT * INTO u FROM public.mcp_admin_users WHERE subject=target FOR UPDATE;
 IF NOT FOUND OR NOT u.enabled THEN RAISE EXCEPTION 'ADMIN_TARGET_DENIED';END IF;
 PERFORM mcp_admin_private.check_issue_scope(a,p_actor,u.project_ids,u.role);
 digest:=encode(sha256(convert_to(jsonb_build_array(target,expected)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM mcp_admin_private.issue_receipts WHERE operation_id=op;
 IF FOUND THEN
  IF receipt.actor_subject<>a.subject OR receipt.request_digest<>digest THEN RAISE EXCEPTION 'ADMIN_OPERATION_CONFLICT';END IF;
  PERFORM mcp_admin_private.check_issue_scope(a,p_actor,receipt.project_ids,receipt.issued_role);
  SELECT * INTO k FROM public.mcp_admin_credentials WHERE id=receipt.credential_id;
  IF NOT FOUND OR k.subject<>target OR k.revoked_at IS NOT NULL OR k.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ADMIN_TARGET_DENIED';END IF;
  PERFORM mcp_admin_private.check_issue_scope(a,p_actor,k.issued_project_ids,k.issued_role);is_replay:=true;
 ELSE
  IF u.version<>expected THEN RAISE EXCEPTION 'ADMIN_VERSION_CONFLICT';END IF;
  INSERT INTO public.mcp_admin_credentials(subject,secret_hash) VALUES(target,p_candidate_hash) RETURNING * INTO k;
  INSERT INTO public.mcp_admin_audit(actor,action,subject,credential_id,operation_id,project_ids)
   VALUES(a.subject,'issue_credential_scoped_v1',target,k.id,op,u.project_ids);
  INSERT INTO mcp_admin_private.issue_receipts VALUES(op,a.subject,digest,target,expected,k.id,u.role,u.project_ids,clock_timestamp());
 END IF;
 -- Recheck proof/managed key/DB lease immediately before returning from this write transaction.
 PERFORM mcp_admin_private.verified_authority(p_actor,true);
 RETURN jsonb_build_object('operationId',op,'credentialId',k.id,'subject',target,'userVersion',expected,'keyVersion',k.version,
 'expiresAt',floor(extract(epoch FROM k.expires_at))::bigint,'replayed',is_replay,'candidateAccepted',NOT is_replay,'secretUnavailable',is_replay);
END $$;
-- Explicit lifecycle, no renewal, no authority enrollment or epoch auto-repair.
-- Trusted backend may write lease rows, never authority configuration. Private tables are not Data API exposed.
GRANT INSERT ON mcp_admin_private.leases TO service_role;
GRANT UPDATE(revoked_at) ON mcp_admin_private.leases TO service_role;
CREATE FUNCTION public.mcp_admin_lease_v1(p_actor jsonb,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE a mcp_admin_private.authorities;l mcp_admin_private.leases;action text;expiry timestamptz;proof_exp timestamptz;
BEGIN
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_object_keys(p_request)x WHERE x NOT IN ('action','expiresAt'))
 OR coalesce(p_actor->>'leaseIdHash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ADMIN_LEASE_DENIED';END IF;
 action:=p_request->>'action';
 IF action IS NULL OR action NOT IN ('register','get','revoke') THEN RAISE EXCEPTION 'ADMIN_LEASE_DENIED';END IF;
 PERFORM mcp_admin_private.gate();
 IF action='revoke' THEN
  -- Revocation is allowed after role/epoch/proof expiry. It can only close this exact server session binding.
  IF NOT(p_actor ?& ARRAY['subject','sourceReference','proofExpiresAt','authEpoch','policyDigest']) THEN RAISE EXCEPTION 'ADMIN_LEASE_DENIED';END IF;
  SELECT * INTO l FROM mcp_admin_private.leases WHERE id_hash=p_actor->>'leaseIdHash';
  IF FOUND THEN
   IF l.subject IS DISTINCT FROM p_actor->>'subject' OR l.source_reference IS DISTINCT FROM p_actor->>'sourceReference'
    OR l.proof_expires_at IS DISTINCT FROM to_timestamp((p_actor->>'proofExpiresAt')::bigint) THEN RAISE EXCEPTION 'ADMIN_LEASE_DENIED';END IF;
   UPDATE mcp_admin_private.leases SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id_hash=l.id_hash;
  ELSE
   -- A tombstone prevents a delayed registration from resurrecting a session after logout.
   proof_exp:=to_timestamp((p_actor->>'proofExpiresAt')::bigint);
   expiry:=least(to_timestamp((p_request->>'expiresAt')::bigint),proof_exp,clock_timestamp()+interval '15 minutes');
   IF expiry>clock_timestamp() THEN
    INSERT INTO mcp_admin_private.leases(id_hash,subject,auth_epoch,source_reference,policy_digest,proof_expires_at,expires_at,revoked_at)
    VALUES(p_actor->>'leaseIdHash',p_actor->>'subject',(p_actor->>'authEpoch')::bigint,p_actor->>'sourceReference',p_actor->>'policyDigest',proof_exp,expiry,clock_timestamp());
   END IF;
  END IF;
  RETURN jsonb_build_object('idHash',p_actor->>'leaseIdHash','revoked',true);
 END IF;
 a:=mcp_admin_private.verified_authority(p_actor,action='get');
 IF action='register' THEN
  PERFORM mcp_admin_private.check_issue_scope(a,p_actor,ARRAY(SELECT jsonb_array_elements_text(p_actor->'projectIds')),'viewer');
  proof_exp:=to_timestamp((p_actor->>'proofExpiresAt')::bigint);expiry:=to_timestamp((p_request->>'expiresAt')::bigint);
  IF expiry IS NULL OR expiry<=clock_timestamp() OR expiry>proof_exp OR expiry>clock_timestamp()+interval '15 minutes' THEN RAISE EXCEPTION 'ADMIN_LEASE_DENIED';END IF;
  INSERT INTO mcp_admin_private.leases(id_hash,subject,auth_epoch,source_reference,policy_digest,proof_expires_at,expires_at)
  VALUES(p_actor->>'leaseIdHash',a.subject,a.auth_epoch,p_actor->>'sourceReference',a.policy_digest,proof_exp,expiry) ON CONFLICT DO NOTHING;
  SELECT * INTO l FROM mcp_admin_private.leases WHERE id_hash=p_actor->>'leaseIdHash';
  IF l.expires_at IS DISTINCT FROM expiry THEN RAISE EXCEPTION 'ADMIN_LEASE_CONFLICT';END IF;
  a:=mcp_admin_private.verified_authority(p_actor,true);
 ELSE
  SELECT * INTO l FROM mcp_admin_private.leases WHERE id_hash=p_actor->>'leaseIdHash';
 END IF;
 RETURN jsonb_build_object('idHash',l.id_hash,'authEpoch',l.auth_epoch,'expiresAt',floor(extract(epoch FROM l.expires_at))::bigint,'policyDigest',l.policy_digest);
END $$;
REVOKE ALL ON FUNCTION public.mcp_admin_lease_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_admin_lease_v1(jsonb,jsonb) TO service_role;

-- Control-plane stage only. Owner-only; never exposed to the runtime backend.
-- Atomic DB close + monotonic epoch + manifest binding + revocation. Activation requires a separately reviewed owner action.
CREATE FUNCTION mcp_admin_private.stage_authority(p_subject text,p_expected_epoch bigint,p_source_reference text,p_policy_digest text) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a mcp_admin_private.authorities;next_identity text;next_credential uuid;
BEGIN
 PERFORM mcp_admin_private.gate();SELECT * INTO a FROM mcp_admin_private.authorities WHERE subject=p_subject FOR UPDATE;
 IF NOT FOUND OR p_expected_epoch IS NULL OR a.auth_epoch<>p_expected_epoch OR coalesce(p_policy_digest,'') !~ '^[0-9a-f]{64}$'
 OR p_source_reference IS NULL THEN RAISE EXCEPTION 'ADMIN_EPOCH_CONFLICT';END IF;
 -- Separate typed assignment avoids planner folding an ENV binding into a UUID cast in a dead CASE arm.
 IF a.source='env' THEN next_identity:=p_source_reference;ELSE next_credential:=p_source_reference::uuid;END IF;
 UPDATE mcp_admin_private.authorities SET active=false,auth_epoch=auth_epoch+1,policy_digest=p_policy_digest,
  identity_version=next_identity,credential_id=next_credential WHERE subject=p_subject RETURNING auth_epoch INTO p_expected_epoch;
 UPDATE mcp_admin_private.leases SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE subject=p_subject;
 RETURN p_expected_epoch;
END $$;

-- Current managed identity metadata only. No secret hashes, keys, enrollment or fallback to role-only authority.
CREATE FUNCTION public.mcp_admin_managed_principal_v1(p_subject text,p_credential_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE u public.mcp_admin_users;k public.mcp_admin_credentials;r record;p text;role_name text;per_project jsonb:='{}';projects text[]:='{}';effective text[];n int;
BEGIN
 SELECT * INTO u FROM public.mcp_admin_users WHERE subject=p_subject;
 IF NOT FOUND OR NOT u.enabled THEN RETURN NULL;END IF;
 SELECT * INTO k FROM public.mcp_admin_credentials WHERE id=p_credential_id AND subject=p_subject;
 IF NOT FOUND OR k.revoked_at IS NOT NULL OR k.expires_at<=clock_timestamp() OR k.issued_role IS NULL OR k.issued_project_ids IS NULL THEN RETURN NULL;END IF;
 role_name:=CASE WHEN mcp_admin_private.role_rank(u.role)<=mcp_admin_private.role_rank(k.issued_role) THEN u.role ELSE k.issued_role END;
 FOREACH p IN ARRAY u.project_ids LOOP
  IF NOT p=ANY(k.issued_project_ids) THEN CONTINUE;END IF;n:=0;effective:='{}';
  FOR r IN SELECT g.*,tr.write_enabled AS allow_write FROM public.get_team_access_snapshot(p_subject) g
   JOIN public.team_resources tr ON tr.id::text=g."resourceId" AND tr.team_id::text=g."teamId"
   WHERE g."provider"='github_projects' AND g."externalResourceId"=p AND tr.kind='github_project_v2' LOOP
   n:=n+1;IF n>1 THEN RAISE EXCEPTION 'ADMIN_ACL_AMBIGUOUS';END IF;
   IF NOT coalesce(r."permissions",mcp_admin_private.role_permissions(r."grantRole"))<@mcp_admin_private.role_permissions(r."grantRole") THEN RAISE EXCEPTION 'ADMIN_SCOPE_DENIED';END IF;
   SELECT array_agg(x) INTO effective FROM unnest(mcp_admin_private.role_permissions(role_name)) x
    WHERE x=ANY(mcp_admin_private.role_permissions(r."teamRole")) AND x=ANY(coalesce(r."permissions",mcp_admin_private.role_permissions(r."grantRole")))
    AND (r.allow_write OR x='project.read');
  END LOOP;
  IF 'project.read'=ANY(effective) THEN projects:=array_append(projects,p);per_project:=per_project||jsonb_build_object(p,effective);END IF;
 END LOOP;
 IF k.expires_at<=clock_timestamp() THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('id',p_subject,'role',role_name,'permissions',mcp_admin_private.role_permissions(role_name),'projectIds',projects,'resourcePermissions',per_project,'source','oauth');
END $$;
REVOKE ALL ON FUNCTION public.mcp_admin_managed_principal_v1(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_admin_managed_principal_v1(text,uuid) TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mcp_admin_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mcp_admin_private TO service_role;
REVOKE EXECUTE ON FUNCTION mcp_admin_private.stage_authority(text,bigint,text,text) FROM service_role;
REVOKE ALL ON FUNCTION public.mcp_admin_issue_credential_scoped_v1(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_admin_issue_credential_scoped_v1(jsonb,jsonb,text) TO service_role;
-- Remove the obsolete backend entrypoint; the insert trigger also bounds direct/owner insert races.
REVOKE ALL ON FUNCTION public.mcp_admin_issue_credential(text,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
