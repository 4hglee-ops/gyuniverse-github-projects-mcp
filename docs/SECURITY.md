# Security Model

## Security posture

Gyuniverse GitHub Projects MCP is designed around a read-first, fail-closed model with explicit authorization boundaries for every write-capable operation.

The public availability of the source code or hosted endpoint does **not** grant access to any GitHub Project.

```text
Publicly reachable
      ≠
Publicly authorized
```

Authenticated operations are constrained by OAuth scope, configured identity, owner and Project allowlists, Project membership, operation capability, server write gates, and operation-specific validation.

## Credential boundary

GitHub credentials stay server-side and are never issued as MCP OAuth tokens.

Never commit or expose:

- GitHub PATs or GitHub App tokens
- OAuth signing secrets
- OAuth team/access codes
- GPT Actions client secrets
- Upstash credentials
- bearer or refresh tokens
- cookies or Authorization headers
- real `.env` files

`.env.example` contains placeholders only and is safe to commit when kept free of real credentials.

## Recommended token strategy

Use the least privilege required for the workflow.

1. Start with GitHub Projects read permission.
2. Validate Project, field, item, snapshot, and relationship reads.
3. Enable GitHub Projects write permission only when mutations are required.
4. Keep `GITHUB_PROJECTS_WRITE_ENABLED=false` until write behavior is intentionally enabled.
5. Keep remote OAuth writes disabled unless `MCP_OAUTH_WRITE_ENABLED=true` is also explicitly required.

## Authorization chain

```text
OAuth identity + scope
        ↓
Owner allowlist
        ↓
Project allowlist
        ↓
Identity Project membership
        ↓
Operation capability
        ↓
Global write gate
        ↓
Precondition / full preflight
        ↓
GitHub mutation
        ↓
Normalized re-read verification
        ↓
Durable audit
```

Roles are convenience bundles. Runtime authorization is capability-based. An identity-specific permission snapshot may narrow a role but cannot expand it beyond the role default.

See [`SECURITY_PERMISSIONS.md`](SECURITY_PERMISSIONS.md) for the detailed ACL matrix.

## Read boundary

For authenticated remote access, owner and Project boundaries are explicit.

- `GITHUB_PROJECTS_ALLOWED_OWNERS` restricts reachable owners.
- `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS` restricts authenticated Project access.
- An OAuth identity must also include the target Project in its own `projectIds` membership.

Remote authenticated access fails closed when required authorization boundaries are not configured.

Local compatibility reads can be configured differently for development, but they should not be treated as a production authorization model.

## Write boundary

A write is allowed only when all relevant gates pass, including:

1. the server-side GitHub credential has the required Projects permission
2. `GITHUB_PROJECTS_WRITE_ENABLED=true`
3. the target Project is explicitly allowlisted
4. the authenticated identity belongs to the target Project
5. the identity has the required operation capability
6. remote OAuth writes have `projects:write` and `MCP_OAUTH_WRITE_ENABLED=true` when applicable
7. operation-specific validation or preflight succeeds

Supported high-level writes include guarded Status/Priority changes, item operations, relationship operations, and bounded bulk Status/Priority plans according to the configured ACL.

Destructive delete-style tools are intentionally not exposed by default.

## Relationship safety

Relationship writes are bounded single-edge operations. They require Admin-level relationship capability and verify reciprocal GitHub state after mutation.

The current implementation does not provide unrestricted reparenting or arbitrary graph mutation.

## Bulk safety

Bulk changes use a governed three-stage workflow:

```text
Preview
   ↓
Approval
   ↓
Apply
```

Key guarantees include:

- one Project per plan
- Status/Priority-only bulk scope
- bounded operation count
- immutable digest-bound Preview plans
- explicit approval
- full authorization and stale-state preflight before mutation
- zero writes when preflight fails
- compare-and-set single-use Apply semantics
- per-item verification and durable audit correlation
- optional distinct-Admin maker-checker policy

Bulk operations do not provide automatic rollback or partial resume.

## OAuth and remote deployment

The remote endpoint supports OAuth protected-resource / authorization-server discovery, public DCR, PKCE S256, and request-scoped bearer authorization.

Production deployments use a shared durable replay store. Vercel production is configured to reject process-local memory replay storage; authorization-code replay protection uses Upstash Redis and fails closed when the required durable store is unavailable.

Authorization codes are represented by SHA-256 digests in replay state rather than storing raw codes.

## Durable operational state

Production checkpoint baselines, bulk plan state, and bounded write audit records use Upstash-backed storage under isolated namespaces.

These records are operational evidence, not a complete compliance or SIEM archive. They are intentionally bounded and must not contain GitHub PATs, OAuth codes, client secrets, cookies, Authorization headers, or credential snapshots.

## Hosted endpoint and self-hosting

The maintainer-operated endpoint is publicly reachable for supported clients, but authorization remains restricted to identities and Projects configured by the maintainer.

External users who want to operate against their own GitHub Projects should generally self-host the server and configure their own:

- GitHub credential
- allowed owners and Project IDs
- OAuth identities and capabilities
- write gates
- durable store
- public base URL

Do not assume that connecting to the maintainer-operated endpoint grants access to arbitrary GitHub accounts or Projects.

## Production validation status

M10 Advanced Governance has completed bounded Production validation. The closeout regression suite recorded **236 / 236 tests passed** and validated representative OAuth, authorization, relationship, bulk-governance, checkpoint, and durable-audit paths.

Deferred non-blocking validation remains documented in [`M10_CLOSEOUT.md`](M10_CLOSEOUT.md), including role-specific live smoke cases that should be run only when suitable real identities already exist.

## Vulnerability reporting

Do not open a public issue containing credentials, exploit details that would expose active infrastructure, or private Project data.

Use GitHub private vulnerability reporting when enabled, or contact the maintainer privately. Sanitize logs and screenshots before sharing them publicly.
