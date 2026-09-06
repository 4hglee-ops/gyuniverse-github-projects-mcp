# Architecture

## Goal

`gyuniverse-github-projects-mcp` is a focused MCP server for GitHub Projects v2. It intentionally does not reimplement the whole GitHub API. Repository code, Issues, Pull Requests, Actions, and review workflows can continue to use existing GitHub tooling; this server owns the Projects-specific team-state and workflow layer.

> Architecture V2 is tracked in `docs/ARCHITECTURE_V2.md`. The V2 direction preserves this working Remote MCP surface while extracting shared business logic behind MCP and REST/GPT Actions adapters.

## Local and remote entry points

The same MCP tool surface is built by `src/mcp/build-server.ts` and can be reached through two different transport boundaries.

```text
Local AI client
    |
    | stdio
    v
src/mcp/stdio.ts
    |
    v
buildMcpServer()
```

```text
ChatGPT / Claude / remote client
    |
    | MCP OAuth bearer token
    v
src/http/router.ts
    |
    +--> OAuth discovery / registration / authorize / token
    |
    v
src/http/remote-mcp.ts
    |
    | request-scoped effective AppConfig
    v
buildMcpServer()
    |
    | server-side GitHub credential
    v
GitHub GraphQL API
```

The client-facing OAuth credential is never the GitHub credential. `GITHUB_TOKEN` remains server-side and is used only by `GitHubGraphQlClient`.

## Core Projects layers

```text
buildMcpServer()
          |
          +---------------------------+
          |                           |
          v                           v
 read / analysis tools       gated workflow write tools
          |                           |
          |                 Status / Priority by name
          |                           |
          |                    membership check
          |                           |
          |                    mutation + re-read
          |                           |
          +-------------+-------------+
                        v
              src/github/projects.ts
                        |
                        v
              GitHub GraphQL API
                        |
                        v
                 GitHub Projects v2
```

Process-local workflow helpers sit beside the GitHub adapter:

```text
src/workflow/
├── checkpoint.ts            # normalized checkpoint + delta comparison
├── reconciliation.ts        # PR merge ↔ Project Status analysis
├── state-gaps.ts            # missing Status / assignee analysis
├── single-select-update.ts  # guarded named Status/Priority update core
└── write-audit.ts           # bounded mutation audit metadata schema
```

## Remote HTTP / OAuth layers

```text
src/http/
├── router.ts                 # platform-neutral Request -> Response routing
├── remote-mcp.ts             # bearer validation + request-scoped MCP handler
├── node-server.ts            # long-lived node:http adapter
└── vercel.ts                 # Vercel Web Fetch handler

src/oauth/
├── stateless.ts              # signed client/code/token envelopes + scope policy
├── endpoints.ts              # discovery, DCR, approval, PKCE token exchange
├── replay-store.ts           # memory and Redis replay implementations
└── replay-store-factory.ts   # explicit runtime store selection
```

Current public route contract:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/.well-known/openid-configuration
/oauth/register
/oauth/authorize
/oauth/token
/mcp
/health
```

`router.ts` is intentionally hosting-provider neutral. `node-server.ts` translates
`node:http` requests into the standard Fetch Request/Response contract. `vercel.ts`
exports the same router through Vercel's Web Fetch handler. Neither adapter duplicates
authorization logic.

## OAuth credential model

There are two distinct credential planes.

```text
AI client credential
  = MCP OAuth access token
  = audience-bound to PUBLIC_BASE_URL/mcp
  = projects:read by default

Server GitHub credential
  = GITHUB_TOKEN
  = never returned to the client
  = constrained independently by GitHub permission + owner/project allowlists
```

Current signed OAuth envelopes are HMAC-authenticated with `MCP_OAUTH_SIGNING_SECRET`. Dynamic registration creates a signed public-client identifier. Authorization codes and tokens are resource-bound to the canonical `/mcp` resource.

The authorization flow requires:

- registered/allowlisted redirect URI
- authorization code flow
- PKCE S256
- expected resource parameter
- supported scope
- human `MCP_OAUTH_TEAM_CODE` approval
- short-lived authorization code
- code-verifier match at token exchange

Supported redirect URI families are intentionally limited to known ChatGPT, Claude, and localhost development callbacks.

## Remote write defense in depth

Remote read access uses `projects:read`.

Remote write access is not enabled merely because a client requests `projects:write`.

The final request-scoped MCP configuration computes:

```text
remote writeEnabled
  = server GITHUB_PROJECTS_WRITE_ENABLED
    AND OAuth token contains projects:write
```

Additionally, `projects:write` is not advertised or accepted unless:

```text
MCP_OAUTH_WRITE_ENABLED=true
```

A remote mutation therefore requires all of the following:

```text
MCP_OAUTH_WRITE_ENABLED=true
        AND
OAuth token has projects:write
        AND
GITHUB_PROJECTS_WRITE_ENABLED=true
        AND
explicit Project node ID allowlist match
        AND
normal tool-level validation succeeds
```

The high-level Status/Priority tools then add item→Project membership verification, exact field/option resolution, no-op detection, and post-mutation read-back verification.

A `projects:read` token forces GitHub writes off for that request even when the process-level GitHub write gate is enabled.

## High-level Status/Priority update sequence

```text
owner + Project number + item ID + requested option name
        |
        v
resolve allowed Project
        |
        v
require write gate + explicit Project allowlist
        |
        v
resolve exact single-select field and exact option name
        |
        v
read ProjectV2Item.project and current field value
        |
        +-- Project mismatch --> fail closed
        |
        +-- already requested value --> verified no-op
        |
        v
updateProjectV2ItemFieldValue
        |
        v
re-read Project membership + field value
        |
        +-- mismatch --> MUTATION_VERIFICATION_FAILED
        |
        v
verified success + audit record
```

## OAuth replay semantics

Authorization codes are signed and expire quickly, but signature + expiry alone do not make a bearer authorization code one-time-use.

M3 includes a consumed-code replay-store contract with local memory and shared Redis
implementations:

```text
authorization code exchange
        |
        v
verify signature / client / redirect / resource / PKCE
        |
        v
atomically consume code (`SET NX EXAT` in production Redis)
        |
        +-- already consumed --> invalid_grant
        |
        v
issue tokens
```

The memory implementation is limited to one process and is intended for local development.
The Upstash implementation hashes the authorization code before using it as a key and
uses atomic Redis `SET NX` with the signed code expiry, providing shared one-time semantics
across Vercel Function instances. Production rejects the memory implementation and does
not silently fall back when Redis is unavailable.

## Governance operational state

The following use the configured M10 governance persistence boundary:

- Project checkpoint baselines
- write audit entries

Local development defaults to process memory. Production reuses the OAuth replay Upstash deployment with isolated checkpoint and audit key namespaces. Audit append and bounded retention are atomic, and malformed durable data fails closed.

## Design principles

1. **Projects-focused**: Avoid duplicating general GitHub repository tooling.
2. **Read-first**: Read operations are the default operating mode.
3. **Credential separation**: MCP OAuth credentials never expose or replace the server GitHub credential.
4. **Explicit writes**: Local GitHub mutations require `GITHUB_PROJECTS_WRITE_ENABLED=true`.
5. **Remote write is stricter**: Remote writes additionally require explicitly enabled OAuth write scope.
6. **Allowlist boundaries**: Owners and optionally Project node IDs can be restricted; an explicit Project allowlist is mandatory for writes.
7. **No delete tools**: destructive Project/Project-item deletion is intentionally absent.
8. **Evidence-preserving normalization**: snapshots retain repository, issue/PR number, URL, assignee, project fields, and item IDs.
9. **Workflow state is not completion proof**: AI brief contracts must not treat assignment, intention, or an open PR as completed implementation.
10. **High-level workflow writes are preferred**: Status/Priority tools resolve exact field/option names internally instead of asking the model to supply raw field/option node IDs.
11. **Verify writes**: high-level Status/Priority writes validate item→Project membership before mutation and re-read the field after mutation.
12. **No-op before mutation**: if the requested Status/Priority is already set, the high-level path skips the mutation.
13. **Bounded audit metadata**: durable Production write audit records operation/target/outcome/verification metadata without storing tokens, Authorization headers, or arbitrary raw mutation payloads.
14. **Provider-neutral remote core**: OAuth and MCP authorization semantics live outside any hosting adapter.
15. **Fail closed on deployment uncertainty**: multi-instance replay semantics must be solved explicitly before claiming production-safe distributed OAuth deployment.
16. **Shared-Core V2**: MCP and REST/GPT Actions should be sibling adapters over one business-logic core, never chained transports.
17. **Identity before broad writes**: team-code approval is not individual identity; operation-level authorization is required before expanding remote write access.

## Current tool surface

### Read / analysis

- `list_github_projects`
- `get_github_project`
- `list_github_project_fields`
- `list_github_project_items`
- `resolve_github_issue_or_pr_url`
- `resolve_github_project_item`
- `get_github_project_snapshot`
- `analyze_github_project_state_gaps`
- `analyze_github_project_reconciliation`
- `create_github_project_state_checkpoint` (configured governance state only; no GitHub mutation)
- `compare_github_project_state_checkpoint`
- `get_github_project_brief_context`
- `list_github_project_write_audit_log`

### Write (disabled by default)

Preferred workflow-level tools:

- `update_github_project_item_status`
- `update_github_project_item_priority`

Lower-level compatibility tools:

- `add_github_project_item`
- `update_github_project_item_field`

## Remaining boundaries

- normalized snapshot-wide analysis is still bounded by the first 100 returned Project items; the pagination-aware single-item resolver is exhaustive within configured page limits
- real write integration tests require an intentionally write-capable GitHub credential, explicit Project allowlist, and write gate; CI remains secret-free and does not run write smoke tests
- checkpoint and write-audit state are durable with Upstash in Production and process-local in the explicit development fallback
- individual user identity / ACL is not implemented yet; `MCP_OAUTH_TEAM_CODE` remains a shared approval gate
- Project #2 operating fields/views/native automations are the next milestone
- Draft PR → Ready for review, merge, release, actual deployment, credential provisioning, and external auth-provider adoption remain human-governance / architecture boundaries
