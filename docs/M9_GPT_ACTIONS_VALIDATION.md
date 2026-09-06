# M9 GPT Actions Live Validation

This runbook validates the Custom GPT Actions adapter after the REST/OpenAPI surface is deployed.

## Architecture

```text
Custom GPT Action
  -> OAuth authorization-code flow
  -> /api/v1/* REST adapter
  -> Shared Core
  -> GitHub GraphQL
```

The REST adapter and MCP adapter are siblings. REST does not call MCP.

## Required Production settings

Existing Project/operator settings remain authoritative:

- `GITHUB_PROJECTS_ALLOWED_OWNERS`
- `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`
- `GITHUB_PROJECTS_WRITE_ENABLED=true` for write validation
- `MCP_OAUTH_WRITE_ENABLED=true` for `projects:write`
- `MCP_OAUTH_IDENTITIES_JSON`
- `MCP_OAUTH_SIGNING_SECRET`
- production replay-store settings

Custom GPT Actions additionally requires:

- `GPT_ACTIONS_OAUTH_CLIENT_ID`
- `GPT_ACTIONS_OAUTH_CLIENT_SECRET`

The client secret is a credential. Never commit it, log it, paste it into issues/docs, or include it in test output.

## Custom GPT Action configuration

Use the deployed OpenAPI document:

- Schema URL: `https://gyuniverse-github-projects-mcp.vercel.app/openapi.json`
- Authentication: OAuth
- Authorization URL: `https://gyuniverse-github-projects-mcp.vercel.app/oauth/authorize`
- Token URL: `https://gyuniverse-github-projects-mcp.vercel.app/oauth/token`
- Client ID: exact value configured as `GPT_ACTIONS_OAUTH_CLIENT_ID`
- Client Secret: exact secret configured as `GPT_ACTIONS_OAUTH_CLIENT_SECRET`
- Scope: `projects:read projects:write`
- Token exchange: `client_secret_basic` or `client_secret_post`

After a deployment adds or renames Actions operations, re-import the deployed
`/openapi.json` document in the Custom GPT editor and save/update the GPT. The
editor does not discover MCP tool registrations automatically. If OAuth client,
callback and scopes are unchanged, this schema refresh does not itself require a
new client secret or a different OAuth configuration.

Copy the callback URL shown by the GPT editor exactly. Supported Custom GPT callback shapes are:

- `https://chatgpt.com/aip/g-.../oauth/callback`
- `https://chat.openai.com/aip/g-.../oauth/callback`

The server also retains the newer ChatGPT connector callback allowlist used by Remote MCP.

## OAuth compatibility rules

Two client types intentionally coexist:

1. Remote MCP / connector clients: dynamic registration, public client, PKCE S256, explicit MCP resource.
2. Custom GPT Actions: configured confidential client, client secret at the token endpoint, no PKCE/resource parameter required from ChatGPT. If PKCE is supplied, S256 is still verified.

Both produce the same signed OAuth access-token subject and therefore enter the same Identity / ACL boundary.

## Production validation evidence — complete

### 1. Admin individual identity read ✅

Custom GPT Actions authenticated an individual Admin principal and returned:

- subject: `user:admin-validation`
- role: `admin`
- GitHub login: `4hglee-ops`
- Project membership: `PVT_kwDOEzfCi84BidwG`
- Admin permissions including Project read/write and create/add/assign/status/priority/generic-field writes

No credential material was returned.

### 2. Project read ✅

`getBacklog` succeeded for:

- owner: `gyuniverse-hq`
- number: `2`

Issue #10 / Project item `PVTI_lADOEzfCi84BidwGzg5ouUc` was confirmed in `Backlog`.

### 3. Safe no-change write ✅

`updateWorkItemStatus` set the same item to its existing `Backlog` option.

Observed result:

```text
changed: false
before: Backlog
after: Backlog
verified: true
actorId: user:admin-validation
operation: update_status
outcome: no_change
auditId: write-1
auditPersistence: process-local
```

This confirms the Custom GPT path reuses the same Shared Core verification and actor-aware audit envelope as MCP.

### 4. Read-after-write ✅

A second `getBacklog` call confirmed Issue #10 remained in `Backlog` after the no-change write.

### 5. Member role denial ✅

The Custom GPT was re-authorized with the Member validation identity:

- subject: `user:member-validation`
- role: `member`
- Project membership: `PVT_kwDOEzfCi84BidwG`

`assignWorkItem` was attempted for Issue #10. The operation is outside the Member permission set and was denied before mutation.

Observed action error:

```text
code: PERMISSION_DENIED
message: PERMISSION_DENIED: Principal 'user:member-validation' lacks permission 'item.assign'.
category: authorization
retryable: false
userAction: Use an identity that has permission for this Project and operation, or ask an Admin/PM to perform it.
```

The GPT action surface did not expose the raw HTTP status field, but Production Vercel runtime logs independently confirmed `POST /api/v1/write/assign` returned HTTP `403` for these denied requests.

A subsequent `getBacklog` read confirmed Issue #10 remained `Backlog` and had no assignee mutation.

## Retry safety

Do not blindly retry failed writes.

- `CREATE_WORK_ITEM_PARTIAL_FAILURE`: never automatically create another Issue; inspect the returned Issue URL and Project state first.
- `MUTATION_VERIFICATION_FAILED`: re-read current state before deciding whether another mutation is needed.
- OAuth/ACL/validation failures: fix authorization or input; do not retry unchanged.
- Unknown upstream failures: re-read state first, then at most one retry when the error envelope marks it retryable.

## Completion criteria

All M9 GPT Actions live-validation criteria are now confirmed in Production:

- [x] OpenAPI imports successfully into the GPT editor.
- [x] OAuth authorization completes with an individual identity.
- [x] one read operation succeeds.
- [x] one safe write returns verified no-change.
- [x] same-operation `actorId` is correct.
- [x] read-after-write matches the action response.
- [x] one role-based denial returns the action-safe authorization envelope without mutation.
- [x] Production runtime confirms HTTP 403 for the denied write.

M9 is ready to close. Durable audit persistence remains intentionally deferred to M10.
