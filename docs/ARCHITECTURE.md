# Architecture

## Goal

`gyuniverse-github-projects-mcp` is a focused MCP server for GitHub Projects v2. It intentionally does not reimplement the whole GitHub API. Repository code, Issues, Pull Requests, Actions, and review workflows can continue to use existing GitHub tooling; this server owns the Projects-specific team-state and workflow layer.

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
└── write-audit.ts           # bounded process-local mutation audit metadata
```

## Remote HTTP / OAuth layers

```text
src/http/
├── router.ts                 # platform-neutral Request -> Response routing
└── remote-mcp.ts             # bearer validation + request-scoped MCP handler

src/oauth/
├── stateless.ts              # signed client/code/token envelopes + scope policy
└── endpoints.ts              # discovery, DCR, approval, PKCE token exchange
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

`router.ts` is intentionally hosting-provider neutral. `node-server.ts` is the long-lived
Node adapter: it translates `node:http` requests into the standard Fetch Request/Response
contract and does not duplicate authorization logic. The current process-local replay
store makes a single long-lived Node instance the supported runtime topology until a shared
replay store is introduced.

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

M3 therefore includes a consumed-code replay store. Its current implementation is process-local:

```text
authorization code exchange
        |
        v
verify signature / client / redirect / resource / PKCE
        |
        v
consume code in in-memory replay store
        |
        +-- already consumed --> invalid_grant
        |
        v
issue tokens
```

This gives correct one-time semantics only within the same process lifetime.

It is **not** a distributed replay guarantee across independent serverless instances or horizontally scaled workers. Production topology must account for this explicitly rather than assuming stateless signed codes solve replay globally.

A shared replay/grant store would solve the distributed case but introduces a persistent external dependency. An external authorization provider is another valid architecture, but also changes the authentication boundary. Neither is introduced implicitly by the M3 core.

## Process-local operational state

The following are currently process-local:

- Project checkpoint baselines
- write audit entries
- OAuth consumed authorization-code replay state

Checkpoint and audit loss on restart is an accepted current product limitation. Authorization-code replay state has stronger security semantics and therefore directly affects the acceptable production deployment topology.

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
13. **Bounded audit metadata**: process-local write audit records operation/target/outcome/verification metadata without storing tokens, Authorization headers, or arbitrary raw mutation payloads.
14. **Provider-neutral remote core**: OAuth and MCP authorization semantics live outside any hosting adapter.
15. **Fail closed on deployment uncertainty**: multi-instance replay semantics must be solved explicitly before claiming production-safe distributed OAuth deployment.

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
- `create_github_project_state_checkpoint` (process-local state only; no GitHub mutation)
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
- the remote OAuth/MCP core is not yet attached to a selected production runtime
- live ChatGPT/Claude connection tests require a reachable deployed HTTPS endpoint and deployment secrets
- multi-instance/serverless OAuth code replay semantics require either a topology constraint or shared state/auth service
- Draft PR → Ready for review, merge, release, actual deployment, credential provisioning, shared storage, and external auth-provider adoption remain human-governance / architecture boundaries
