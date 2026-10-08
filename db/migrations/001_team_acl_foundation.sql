-- M12 foundation only. Do not apply to Production until DB connection,
-- credential encryption, migration tooling and operational rollback are ready.
-- Database must be PostgreSQL. No credentials, access codes or tokens belong
-- in these tables. Provider connection secrets live in a separate secret store.
BEGIN;

CREATE TABLE IF NOT EXISTS team_principals (
  id text PRIMARY KEY,
  display_name text,
  github_login text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT principal_id_bounded CHECK (length(id) BETWEEN 1 AND 256)
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_slug_bounded CHECK (length(slug) BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  principal_id text NOT NULL REFERENCES team_principals(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('admin','member','viewer')),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (team_id,principal_id)
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('github_projects','jira')),
  external_tenant_id text NOT NULL,
  credential_ref text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id,id),
  UNIQUE (team_id,provider,external_tenant_id),
  CONSTRAINT external_tenant_id_bounded CHECK (length(external_tenant_id) BETWEEN 1 AND 256),
  CONSTRAINT credential_ref_bounded CHECK (length(credential_ref) BETWEEN 1 AND 512)
);

CREATE TABLE IF NOT EXISTS team_resources (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('github_projects','jira')),
  kind text NOT NULL CHECK (kind IN ('github_project_v2','jira_project')),
  external_resource_id text NOT NULL,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  write_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id,id),
  UNIQUE (team_id,connection_id,external_resource_id),
  FOREIGN KEY (team_id,connection_id) REFERENCES provider_connections(team_id,id) ON DELETE RESTRICT,
  CONSTRAINT resource_provider_kind_match CHECK (
    (provider='github_projects' AND kind='github_project_v2') OR
    (provider='jira' AND kind='jira_project')
  ),
  CONSTRAINT resource_id_bounded CHECK (length(external_resource_id) BETWEEN 1 AND 256)
);

CREATE TABLE IF NOT EXISTS resource_grants (
  team_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  principal_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','member','viewer')),
  permissions text[], -- NULL=role defaults; empty array=deny
  PRIMARY KEY (team_id,resource_id,principal_id),
  FOREIGN KEY (team_id,resource_id) REFERENCES team_resources(team_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (team_id,principal_id) REFERENCES team_members(team_id,principal_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS team_members_by_principal ON team_members(principal_id) WHERE active;
CREATE INDEX IF NOT EXISTS resource_grants_by_principal ON resource_grants(principal_id);
CREATE INDEX IF NOT EXISTS team_resources_by_connection ON team_resources(connection_id);

-- Only the backend's trusted service account may use this schema. Revoke any
-- direct PUBLIC/anon/authenticated access at the database and expose audited
-- admin actions through a separate authorization-enforcing API.
-- Application code MUST additionally verify active membership, connection
-- state, provider equality, role defaults and capability allowlist.
COMMIT;
