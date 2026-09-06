# M3 Deployment Runtime Decision

## Decision

The production target is Vercel Functions with an Upstash Redis replay store.
The long-lived Node.js HTTP process remains supported for local development and
single-instance hosting.

## Runtime adapters

Both adapters delegate to the same provider-neutral router:

```text
Vercel Request -> api/index.ts -> src/http/vercel.ts ----+
                                                         +-> handleRemoteHttpRequest()
node:http ------> src/http/node-server.ts ---------------+
```

`vercel.json` rewrites OAuth discovery, OAuth endpoints, `/mcp`, and `/health` to
the single Vercel Function.

## Distributed replay protection

Production selects `MCP_OAUTH_REPLAY_STORE=upstash`. Authorization-code consumption
uses one atomic Redis `SET NX` operation with the signed authorization-code expiry.
Only a SHA-256 digest of the code is present in the Redis key.

The supported credential pairs are:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Vercel Marketplace aliases `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- namespaced Marketplace variables `MCP_REPLAY_KV_REST_API_URL` and
  `MCP_REPLAY_KV_REST_API_TOKEN`

Production fails closed when the store is not explicitly selected, when memory is
selected, or when Redis is unavailable.

## Current support

- local development: supported with memory replay store
- single Node runtime: supported
- Vercel Functions: adapter and shared-store implementation complete; provisioning pending
- multi-instance OAuth replay semantics: supported with Upstash Redis
- checkpoint baselines and bounded write audit history: durable with the shared Upstash deployment under isolated namespaces
