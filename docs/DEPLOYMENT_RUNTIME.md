# M3 Deployment Runtime Decision

## Decision

M3 remote MCP initial deployment target:

- long-lived Node.js HTTP process
- single active instance initially
- explicit scaling decision before replicas

## Reason

The OAuth authorization-code replay protection currently uses a process-local replay store. A stateless serverless deployment can route exchanges to different workers and cannot guarantee global one-time-code consumption without shared state.

## Implemented adapter

`src/http/node-server.ts` provides the initial Node.js runtime adapter.

Flow:

```
HTTP request
   -> Node HTTP adapter
   -> Fetch Request
   -> handleRemoteHttpRequest()
   -> Response
```

The core router remains platform-neutral.

## Vercel / serverless assessment

Not selected for the first runtime.

Before multi-instance/serverless deployment:

- implement shared OAuthReplayStore
- select Redis/KV/database or external authorization service
- validate distributed replay behavior
- provision deployment secrets

## Current support

- local development: supported
- single Node runtime: supported
- multi-instance/serverless: deferred
