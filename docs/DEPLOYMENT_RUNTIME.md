# M3 Deployment Runtime Decision

## Decision

M3 remote MCP should not be deployed on a stateless serverless runtime as the first production target.

Recommended runtime:

- long-lived Node.js HTTP process
- single active instance initially
- explicit scaling decision before multiple replicas

## Reason

The current OAuth authorization-code replay protection uses a process-local replay store.

A stateless serverless deployment can route two token exchange requests for the same authorization code to different instances. In that case each instance has its own memory state and cannot guarantee global one-time-code consumption.

The current implementation is intentionally honest about this limitation:

- local development: supported
- single long-lived instance: supported
- horizontally scaled/serverless deployment: requires shared replay state

## Vercel / serverless assessment

Vercel serverless is suitable only after introducing one of:

1. shared replay store (Redis/KV/database)
2. external authorization service
3. deployment architecture that guarantees affinity to a single instance

Without one of these, OAuth replay guarantees are weaker than intended.

## Next production boundary

Before multi-instance deployment:

- select shared replay storage
- add deployment adapter
- provision secrets through deployment secret management
- run live ChatGPT/Claude OAuth smoke tests
