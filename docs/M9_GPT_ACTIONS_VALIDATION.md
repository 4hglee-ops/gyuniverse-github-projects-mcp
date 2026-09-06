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
- Token exchange: request body / `client_secret_post` when the editor offers that choice

Copy the callback URL shown by the GPT editor exactly. Supported Custom GPT callback shapes are:

- `https://chatgpt.com/aip/g-.../oauth/callback`
- `https://chat.openai.com/aip/g-.../oauth/callback`

The server also retains the newer ChatGPT connector callback allowlist used by Remote MCP.

## OAuth compatibility rules

Two client types intentionally coexist:

1. Remote MCP / connector clients: dynamic registration, public client, PKCE S256, explicit MCP resource.
2. Custom GPT Actions: configured confidential client, client secret at the token endpoint, no PKCE/resource parameter required from ChatGPT. If PKCE is supplied, S256 is still verified.

Both produce the same signed OAuth access-token subject and therefore enter the same Identity / ACL boundary.

## Live validation sequence

Use an Admin validation identity first.

### 1. Identity read

Invoke `getIdentityContext`.

Expected:

- authenticated individual subject
- role = `admin`
- expected GitHub login
- Project #2 node ID in memberships
- no credential material in the response

### 2. Project read

Invoke `getBacklog` or `getProjectBrief` for:

- owner: `gyuniverse-hq`
- number: `2`

Expected: 200 and evidence-backed Project data.

### 3. Safe write

Prefer an idempotent write against a known test item, for example set its current Status to the same current option.

Expected response includes:

- `verified: true`
- `actorId` equal to the authenticated subject
- semantic `operation`
- `outcome: no_change` or `success`
- `auditId`
- `auditPersistence: process-local`

### 4. Read-after-write

Re-read the same Project/item and verify the actual server state matches the action response.

### 5. Permission denial

Reconnect as Member or Viewer and exercise an operation outside that role's permission set.

Expected:

- HTTP 403
- stable `PERMISSION_DENIED` or membership error
- `category: authorization`
- `retryable: false`
- actionable `userAction`
- no mutation

## Retry safety

Do not blindly retry failed writes.

- `CREATE_WORK_ITEM_PARTIAL_FAILURE`: never automatically create another Issue; inspect the returned Issue URL and Project state first.
- `MUTATION_VERIFICATION_FAILED`: re-read current state before deciding whether another mutation is needed.
- OAuth/ACL/validation failures: fix authorization or input; do not retry unchanged.
- Unknown upstream failures: re-read state first, then at most one retry when the error envelope marks it retryable.

## Completion criteria

M9 GPT Actions live validation is complete when all of the following are confirmed in Production:

- OpenAPI imports successfully into the GPT editor.
- OAuth authorization completes with an individual identity.
- one read operation succeeds.
- one safe write succeeds or returns verified no-change.
- same-operation `actorId` is correct.
- read-after-write matches the action response.
- one role-based denial returns the action-safe 403 envelope without mutation.
