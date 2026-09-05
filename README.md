# gyuniverse-github-projects-mcp

Focused MCP server for safe GitHub Projects v2 team workflows.

This repository is intentionally narrower than a general GitHub MCP server. It focuses on Projects metadata, fields, items, normalized team-state snapshots, workflow reconciliation, checkpoint/delta analysis, guarded workflow mutations, write auditing, and an authenticated remote MCP surface.

## Status

**v0.3 / M3 complete + M4 Project Operating Foundation in progress**

- M1 local Projects MCP complete
- M2 workflow intelligence complete
- Remote HTTP request router implemented
- OAuth protected-resource / authorization-server discovery implemented
- Public PKCE client registration and authorization flow implemented
- ChatGPT / Claude callback allowlist support
- OAuth `projects:read` / `projects:write` separation
- GitHub credential remains server-side only
- Remote writes require OAuth write scope **and** the existing server-side write gates
- Node and Vercel HTTP adapters implemented and live-read validated
- M4 Project #2 inspection and guarded operating-foundation setup available
- No delete tools

## MCP tools

### GitHub read / analysis

| Tool | Purpose |
| --- | --- |
| `list_github_projects` | List Projects for an allowed user or organization |
| `get_github_project` | Read one Project by owner + project number |
| `list_github_project_fields` | Read Status, Priority, Iteration and other fields/options |
| `list_github_project_items` | Read issues, PRs, draft items and field values |
| `resolve_github_issue_or_pr_url` | Resolve a GitHub Issue/PR URL to stable content metadata and node ID |
| `resolve_github_project_item` | Resolve an Issue/PR URL to its matching Project item with cursor pagination |
| `get_github_project_snapshot` | Normalize project state for AI analysis |
| `analyze_github_project_state_gaps` | Detect missing Status and missing assignee state gaps |
| `analyze_github_project_reconciliation` | Detect PR merge ↔ Project Status mismatches |
| `compare_github_project_state_checkpoint` | Compare current Project state with the latest process-local checkpoint |
| `get_github_project_brief_context` | Return snapshot + team-brief interpretation contract |
| `list_github_project_write_audit_log` | Read recent bounded process-local write audit metadata |

### Local checkpoint state

| Tool | Purpose |
| --- | --- |
| `create_github_project_state_checkpoint` | Capture the current allowed Project snapshot as the process-local comparison baseline |

Creating a checkpoint **does not write to GitHub**. It updates only MCP process memory, replacing the previous checkpoint for the same owner + Project number. The checkpoint does not survive an MCP server restart.

A comparison can report Status, Priority, assignee, repository state, merge state, archive state, custom field, metadata, and snapshot-membership changes. Comparison does not silently replace the baseline; create a new checkpoint explicitly when the current state should become the new baseline.

Current normalized snapshots request at most 100 items. When a snapshot reaches that requested limit, entered/left membership changes are treated as snapshot-window observations rather than authoritative proof of Project add/remove events.

### GitHub write — disabled by default

Preferred high-level workflow tools:

| Tool | Purpose |
| --- | --- |
| `update_github_project_item_status` | Set one Project item's exact Status option by name with Project-membership and post-write verification |
| `update_github_project_item_priority` | Set one Project item's exact Priority option by name with Project-membership and post-write verification |

Lower-level compatibility tools:

| Tool | Purpose |
| --- | --- |
| `add_github_project_item` | Add an existing Issue/PR node to a Project |
| `update_github_project_item_field` | Update text/number/date/single-select/multi-select/iteration fields by node IDs |

There are intentionally **no delete tools**.

The high-level Status/Priority tools should be preferred for AI workflows because they do not require the model to provide raw field and option IDs. They:

1. resolve the allowed Project from owner + Project number
2. require the existing write gate and explicit Project allowlist
3. resolve the exact `Status`/`Priority` single-select field and exact option name
4. query `ProjectV2Item.project` and reject a mismatched item before mutation
5. skip the mutation if the requested value is already set
6. perform one field mutation when needed
7. re-read the item and field after mutation
8. fail if the post-write value does not match
9. append a structured write-audit record

## Why a dedicated Projects MCP?

```text
ChatGPT / Claude / Codex
          |
          | OAuth access token
          v
 Remote GitHub Projects MCP
          |
          | server-side GitHub credential
          v
   GitHub Projects v2 API
```

The OAuth token issued to an AI client is **not** the GitHub PAT / GitHub App credential. The GitHub credential remains on the server and is never returned through OAuth.

General GitHub tooling can continue to handle repository code, Issues, Pull Requests, reviews, and Actions. This server owns the Projects-specific workflow/state layer.

## Requirements

- Node.js 22+
- pnpm
- GitHub token that can access the target Projects

For organization Projects, use a fine-grained token with the minimum required **Projects** organization permission:

- `read` for GitHub read/analysis/checkpoint workflows
- `write` only when mutation tools are intentionally enabled

Your GitHub organization may require approval for fine-grained personal access tokens.

## Local setup

```bash
git clone https://github.com/4hglee-ops/gyuniverse-github-projects-mcp.git
cd gyuniverse-github-projects-mcp
pnpm install
cp .env.example .env
```

Local stdio configuration:

```dotenv
GITHUB_TOKEN=github_pat_...
GITHUB_PROJECTS_ALLOWED_OWNERS=4hglee-ops,gyuniverse-hq
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=
GITHUB_PROJECTS_WRITE_ENABLED=false
```

Then run:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm start
```

Use `pnpm mcp:stdio` during development when you want to run directly from TypeScript.

## Remote MCP core

M3 adds a platform-neutral Fetch `Request -> Response` router in `src/http/router.ts`,
a long-lived Node HTTP adapter in `src/http/node-server.ts`, and a Vercel Fetch adapter
in `src/http/vercel.ts` exposed through `api/index.ts`.

Current routes:

| Route | Purpose |
| --- | --- |
| `/mcp` | OAuth-protected Streamable HTTP MCP endpoint |
| `/.well-known/oauth-protected-resource` | Protected resource metadata |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata |
| `/.well-known/openid-configuration` | Compatibility metadata alias |
| `/oauth/register` | Dynamic registration for supported public PKCE clients |
| `/oauth/authorize` | Human approval + authorization code issuance |
| `/oauth/token` | Authorization-code / refresh-token exchange |
| `/health` | Minimal health response |

The Node adapter translates `node:http` requests into Fetch requests and streams Fetch
responses back to the client. Local development uses the process-local memory replay
store by default. Serverless and horizontally scaled production deployments use the
Upstash Redis adapter for global one-time authorization-code consumption.

Run the TypeScript entrypoint during development:

```bash
pnpm mcp:http
```

For the compiled runtime:

```bash
pnpm build
pnpm start:http
```

The adapter listens on `MCP_HTTP_HOST` (`0.0.0.0` by default) and `MCP_HTTP_PORT`
(`PORT`, then `3000`, as fallbacks). With the server running, execute the assertion-based
runtime smoke test using `pnpm smoke:http`. Set `MCP_HTTP_BASE_URL` when the test must
connect to an address other than `http://localhost:${MCP_HTTP_PORT}`.

### Remote OAuth configuration

In addition to the existing GitHub configuration:

```dotenv
PUBLIC_BASE_URL=https://projects-mcp.example.com
MCP_OAUTH_TEAM_CODE=...
MCP_OAUTH_SIGNING_SECRET=...
MCP_OAUTH_WRITE_ENABLED=false
MCP_OAUTH_REPLAY_STORE=upstash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Vercel Marketplace integrations that inject `KV_REST_API_URL` / `KV_REST_API_TOKEN`,
or the namespaced `MCP_REPLAY_KV_REST_API_URL` / `MCP_REPLAY_KV_REST_API_TOKEN`,
are also supported. Production refuses an implicit memory-store
fallback and fails closed if the selected Upstash store is unavailable. Real values
belong in the deployment secret store and must not be committed.

### OAuth scopes

Default remote scope:

```text
projects:read
```

Optional write scope:

```text
projects:write
```

`projects:write` is not advertised or accepted unless:

```dotenv
MCP_OAUTH_WRITE_ENABLED=true
```

Even then, an OAuth write token **does not by itself permit a GitHub mutation**.

A remote mutation requires all of these boundaries simultaneously:

1. `MCP_OAUTH_WRITE_ENABLED=true`
2. the OAuth access token includes `projects:write`
3. `GITHUB_PROJECTS_WRITE_ENABLED=true`
4. the target Project node ID is explicitly present in `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`
5. the individual mutation's existing validation / membership / verification checks succeed

This means a read-only OAuth token forces `writeEnabled=false` for that request even if the server's GitHub write gate is globally enabled.

### OAuth flow

The current compatibility path supports public PKCE clients:

```text
Client
  |
  | protected-resource discovery
  v
Authorization server metadata
  |
  | dynamic registration
  v
/oauth/register
  |
  | authorization + PKCE S256 + resource + scope
  v
/oauth/authorize
  |
  | human team-code approval
  v
short-lived signed authorization code
  |
  | code_verifier
  v
/oauth/token
  |
  v
short-lived MCP OAuth access token
  |
  v
/mcp
```

Supported redirect URI families are deliberately allowlisted for ChatGPT, Claude, and localhost development. Arbitrary redirect origins are rejected.

Authorization codes expire after two minutes. Access tokens expire after one hour. Refresh tokens expire after 30 days.

### Replay protection

Authorization-code replay prevention is selected by `MCP_OAUTH_REPLAY_STORE`:

- `memory`: local development and single-process testing only
- `upstash`: production shared state using atomic Redis `SET NX` with code expiry

Redis keys contain SHA-256 authorization-code digests rather than bearer code values.
Vercel and `NODE_ENV=production` runtimes require an explicit store selection and reject
the memory adapter. Checkpoint baselines and write audit history remain process-local and
retain their documented restart/lifetime limitations.

## Read-only integration smoke test

After configuring a read-only token in `.env`:

```bash
pnpm smoke:read -- gyuniverse-hq
pnpm smoke:read -- gyuniverse-hq 2
```

The Project-specific command reads metadata, fields, items, and a normalized snapshot. It never invokes a mutation regardless of the write setting.

The read path was integration-tested against `gyuniverse-hq` Project #2 on 2026-09-05 with a fine-grained read-only token.

## Checkpoint / delta workflow

Create a baseline:

```text
Create a state checkpoint for Project #2 under gyuniverse-hq.
```

Later:

```text
Compare Project #2 with its latest checkpoint and show only what changed.
```

Checkpoint storage is intentionally process-local. Persistent storage is a separate architecture decision.

## Guarded write workflow

Local/server-side GitHub write operations require all of the following:

1. the GitHub credential has the minimum required Projects write permission
2. the target Project node ID is explicitly present in `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`
3. `GITHUB_PROJECTS_WRITE_ENABLED=true`

Remote write additionally requires the OAuth write boundary described above.

Example high-level request:

```text
Set Project #2 item PVTI_... Status to Done.
```

The Status/Priority path performs Project membership validation and a post-mutation read-back verification before reporting success.

### Low-level single-select smoke test

The existing manual smoke script remains available for a deliberately selected non-critical item:

```bash
pnpm smoke:update-single-select -- <project-id> <item-id> <field-id> <option-id>
```

Use the minimum mutation count necessary to prove behavior, then restore `GITHUB_PROJECTS_WRITE_ENABLED=false` and reduce the token back to read-only when no further write verification is planned.

## Write audit log

`list_github_project_write_audit_log` exposes the newest process-local write records.

Current properties:

- bounded to the most recent 200 entries
- newest-first reads, maximum 200 entries
- optional Project/item filtering
- records operation, target, outcome and verification state
- high-level Status/Priority writes record requested/before/after option names
- lower-level writes are recorded without arbitrary raw field payloads
- tokens, Authorization headers and raw secret values are never stored
- error records use compact error codes instead of full error response bodies
- process-local only; entries disappear on restart

This is an operational audit aid, not durable compliance logging.

## Safety model

### Owner allowlist

`GITHUB_PROJECTS_ALLOWED_OWNERS` limits users/organizations whose Projects the MCP can read.

### Project allowlist

`GITHUB_PROJECTS_ALLOWED_PROJECT_IDS` is optional for reads. For writes it is mandatory and fail-closed.

### GitHub write gate

```dotenv
GITHUB_PROJECTS_WRITE_ENABLED=false
```

### Remote OAuth write gate

```dotenv
MCP_OAUTH_WRITE_ENABLED=false
```

Remote writes require both gates, the OAuth write scope, the explicit Project allowlist, and the normal mutation validation path.

Checkpoint tools and write-audit reads do not bypass or activate GitHub writes.

## CI validation

Pull requests and pushes to `main` run:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

CI remains secret-free; write smoke tests and deployment do not run automatically.

## Current architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```text
src/
├── config.ts
├── github/
│   ├── graphql-client.ts
│   ├── project-items.ts
│   ├── projects.ts
│   └── references.ts
├── http/
│   ├── remote-mcp.ts
│   └── router.ts
├── oauth/
│   ├── endpoints.ts
│   └── stateless.ts
├── workflow/
│   ├── checkpoint.ts
│   ├── reconciliation.ts
│   ├── single-select-update.ts
│   ├── state-gaps.ts
│   └── write-audit.ts
└── mcp/
    ├── build-server.ts
    ├── checkpoint-tools.ts
    ├── workflow-write-tools.ts
    └── stdio.ts
```

## Roadmap

### M1 — local Projects MCP ✅

- [x] GraphQL client
- [x] Project metadata / fields / items
- [x] normalized project snapshot and team brief context
- [x] gated add-item / field-update mutations
- [x] regression tests, build/start scripts and CI
- [x] real read integration test
- [x] gated write integration test against a non-critical item

### M1.1 — scale backlog

- [ ] pagination beyond first 100 normalized snapshot items

### M2 — workflow intelligence ✅ implementation complete

- [x] Issue / PR URL → node ID resolver
- [x] Issue / PR URL → Project item resolver with cursor pagination
- [x] missing assignee / missing status detection
- [x] PR merge ↔ Project status reconciliation
- [x] project state checkpoint / delta
- [x] safer high-level Status / Priority mutation tools
- [x] bounded process-local write audit log

### M3 — remote MCP ✅

- [x] platform-neutral HTTP MCP request handler
- [x] OAuth protected-resource metadata
- [x] OAuth authorization-server metadata
- [x] PKCE + dynamic client registration compatibility path
- [x] ChatGPT / Claude redirect allowlist
- [x] OAuth read/write scope separation
- [x] remote write defense-in-depth
- [x] secret-free OAuth/HTTP regression tests
- [x] single-instance long-lived Node runtime selected
- [x] Node HTTP deployment adapter
- [x] Vercel Fetch deployment adapter and route rewrites
- [x] Upstash Redis shared OAuth replay store
- [x] fail-closed production store selection
- [x] Vercel project and Upstash Marketplace provisioning
- [x] production secret configuration
- [x] live ChatGPT connection smoke test
- [ ] live Claude connection smoke test

### M4 — Project Operating Foundation ◐

- [x] inspect Project #2, Status, Priority, optional Iteration, field IDs, and API access
- [x] preserve existing Priority P0/P1/P2/P3
- [x] add dry-run-first no-sprint view setup with write gates and re-read verification
- [x] keep Iteration disabled by default for the continuous-flow operating model
- [ ] create/verify Backlog, Active Work, My Work, Review Queue, and Workstream views
- [ ] configure built-in close/merge/auto-add workflows
- [ ] install ready-for-review Actions in the three source repositories

See [`docs/M4_PROJECT_OPERATING_FOUNDATION.md`](docs/M4_PROJECT_OPERATING_FOUNDATION.md)
and [`docs/M4_PROJECT_UI_SETUP.md`](docs/M4_PROJECT_UI_SETUP.md).

## Security

Never commit GitHub tokens, OAuth signing secrets, team codes, or `.env` files.

The client-facing MCP OAuth token and the server-side GitHub credential are separate credentials with separate purposes. OAuth access must never expose or substitute for the GitHub token.

Checkpoint data and write audit records remain process-local. OAuth authorization-code
replay state is process-local only in development and uses the configured shared Upstash
store in production.

## License

No license is currently granted. This repository is private during the initial development phase.
