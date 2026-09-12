# Deployment Runtime

## Production target

The production deployment target is Vercel Functions with Upstash Redis providing shared durable state for OAuth replay protection and M10 governance data.

The long-lived Node.js HTTP adapter remains supported for local development and single-instance hosting.

## Runtime adapters

Both adapters delegate to the same provider-neutral HTTP router and Shared Core:

```text
Vercel Request -> api/index.ts -> src/http/vercel.ts ----+
                                                         +-> handleRemoteHttpRequest()
node:http ------> src/http/node-server.ts ---------------+
```

`vercel.json` routes OAuth discovery, OAuth endpoints, `/mcp`, health endpoints, and the GPT Actions / REST surface to the Vercel runtime.

## Production status

The maintainer-operated Vercel deployment has completed the M10 Production validation cycle.

Validated areas include:

- unauthenticated MCP bearer challenge behavior
- OAuth protected-resource metadata
- authenticated identity and Project reads
- role/capability runtime authorization
- checkpoint persistence
- bounded durable write audit
- relationship read/write paths
- bulk Preview → Approval → Apply governance
- post-deployment regression checks

See [`M10_CLOSEOUT.md`](M10_CLOSEOUT.md) for the bounded Production evidence and known non-blocking limitations.

## Durable replay protection

Production requires a shared replay store:

```dotenv
MCP_OAUTH_REPLAY_STORE=upstash
```

Authorization-code consumption uses an atomic Redis claim with the signed authorization-code expiry. Only a SHA-256 digest of the code is used in replay-state keys.

The supported credential pairs include:

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- Vercel Marketplace `KV_REST_API_URL` + `KV_REST_API_TOKEN`
- namespaced `MCP_REPLAY_KV_REST_API_URL` + `MCP_REPLAY_KV_REST_API_TOKEN`

Production fails closed when durable replay storage is required but unavailable or misconfigured.

## Governance persistence

M10 checkpoint baselines, bounded write audit, and bulk-plan state may reuse the same Upstash deployment under isolated namespaces.

`M10_GOVERNANCE_STORE` can explicitly select the governance store. When omitted in the supported Production configuration, governance state can reuse the OAuth replay Upstash connection.

Durable operational state is intentionally bounded and is not a substitute for an external compliance archive or SIEM.

## Hosted instance vs self-hosting

The maintainer-operated endpoint is a deployed instance of this repository. Public reachability does not imply public authorization.

The hosted instance only authorizes configured identities and Projects. Users who want to operate against their own GitHub Projects should normally self-host and provide their own configuration.

At minimum, a self-hosted deployment should configure:

```dotenv
GITHUB_TOKEN=
GITHUB_PROJECTS_ALLOWED_OWNERS=
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=
GITHUB_PROJECTS_WRITE_ENABLED=false
PUBLIC_BASE_URL=
MCP_OAUTH_SIGNING_SECRET=
MCP_OAUTH_IDENTITIES_JSON=
MCP_OAUTH_REPLAY_STORE=upstash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
MCP_OAUTH_WRITE_ENABLED=false
```

Start read-only. Enable write-related settings only after validating owner/Project allowlists, identity membership, and least-privilege capabilities.

## Environment separation

Production secrets should live only in the deployment provider's secret/environment store. Do not commit real values to the repository.

Use separate values for local development, preview deployments, and Production where practical. In particular, signing secrets, OAuth access codes, confidential GPT Actions credentials, GitHub credentials, and Redis credentials should not be reused casually across trust boundaries.

## Local and single-instance support

Local development may use memory-backed replay/governance storage when explicitly supported by the runtime configuration.

The Node HTTP adapter can be started with:

```bash
pnpm mcp:http
```

The stdio MCP development path remains available with:

```bash
pnpm mcp:stdio
```

For deployment configuration details, use `.env.example` as the canonical variable inventory and [`SECURITY.md`](SECURITY.md) for the authorization and credential boundaries.
