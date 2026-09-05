# Security Model

## Default posture

The server is designed to start in a read-first mode.

- GitHub token is supplied only through environment variables.
- `GITHUB_PROJECTS_WRITE_ENABLED=false` by default.
- Owner allowlists can constrain the reachable account boundary.
- Project node-ID allowlists constrain both read exposure and the mutation boundary.
- Destructive delete tools are not registered in v0.1.

## Recommended token strategy

For initial testing, prefer a fine-grained token with the minimum Projects permission needed for the test.

1. Start with Projects **read** permission.
2. Validate listing, fields, items, and snapshots.
3. Only then create or update a token with Projects **write** permission if mutation testing is required.
4. Keep `GITHUB_PROJECTS_WRITE_ENABLED=false` until the write test itself.

Do not place the token in source code, README examples, MCP configuration committed to Git, screenshots, or issue bodies.

## Read boundary

`GITHUB_PROJECTS_ALLOWED_OWNERS` limits which user or organization owners can be queried.

`GITHUB_PROJECTS_ALLOWED_PROJECT_IDS` is optional for reads:

- empty: all Projects under an allowed owner may be read
- populated: only listed ProjectV2 node IDs are exposed

## Write boundary

Both write tools fail closed unless **all** of the following are true:

1. the token has the required GitHub Projects write permission
2. `GITHUB_PROJECTS_WRITE_ENABLED=true`
3. `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS` is non-empty
4. the target ProjectV2 node ID is explicitly present in that allowlist

An empty Project allowlist therefore never permits writes.

Current writes:

- add an existing Issue/PR to a Project
- update a supported project-item field value, including multi-select

Current non-capabilities by design:

- delete Project items
- delete Projects
- archive Project items
- create or delete fields
- change repository Issues/PRs

## Remote deployment

The remote endpoint includes OAuth discovery, PKCE authorization, request-scoped bearer
authorization, and defense-in-depth mutation gates. Vercel production deployments must
configure `MCP_OAUTH_REPLAY_STORE=upstash`; the runtime rejects the process-local memory
store in production. Authorization codes are SHA-256 hashed before the atomic Redis replay
claim is written, and Redis failures prevent token issuance.

Before public production use, also complete:

- Vercel project and Upstash Marketplace provisioning
- deployment secrets and explicit environment separation
- live OAuth connector validation
- rate limiting
- secret rotation procedure

Mutation audit records and Project checkpoint baselines remain process-local. Do not treat
them as durable compliance logs or durable job state in a serverless deployment.
