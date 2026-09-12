# M7 Identity Validation Runbook

M7 code-side identity, role, permission, Project-membership, read enforcement, and actor audit are implemented. Final milestone closure requires production-style validation with individual OAuth identities.

## Production identity configuration

Configure `MCP_OAUTH_IDENTITIES_JSON` in the deployment environment. Do not commit real access codes.

Example shape only:

```json
[
  {
    "subject": "user:admin-example",
    "accessCode": "<secret-admin-code>",
    "displayName": "Admin Example",
    "githubLogin": "<github-login>",
    "role": "admin",
    "projectIds": ["PVT_kwDOEzfCi84BidwG"]
  },
  {
    "subject": "user:member-example",
    "accessCode": "<secret-member-code>",
    "displayName": "Member Example",
    "githubLogin": "<github-login>",
    "role": "member",
    "projectIds": ["PVT_kwDOEzfCi84BidwG"]
  },
  {
    "subject": "user:viewer-example",
    "accessCode": "<secret-viewer-code>",
    "displayName": "Viewer Example",
    "githubLogin": "<github-login>",
    "role": "viewer",
    "projectIds": ["PVT_kwDOEzfCi84BidwG"]
  }
]
```

Access codes are credentials. Never place real values in GitHub, Notion, Discord, screenshots, logs, or chat messages.

## Safe validation tool

After connecting through OAuth, call `get_identity_context` first. It returns only non-secret identity metadata:

- subject
- display name
- GitHub login
- role
- permissions
- Project node-ID memberships
- identity source

It never returns access codes, bearer tokens, signing secrets, or registry raw JSON.

## Role validation matrix

| Check | Admin | Member | Viewer |
|---|---:|---:|---:|
| `get_identity_context` | allow | allow | allow |
| Project read / high-level reads | allow when member of Project | allow when member of Project | allow when member of Project |
| `get_my_work` | bound to configured GitHub login | bound to configured GitHub login | bound to configured GitHub login |
| add Project item | allow | allow | deny |
| Status update | allow | allow | deny |
| Priority update | allow | allow | deny |
| generic Project field update | allow | deny | deny |
| Project outside `projectIds` | deny | deny | deny |

The server-level `GITHUB_PROJECTS_WRITE_ENABLED` gate and explicit `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS` remain mandatory for every write even when the role allows it.

## Required live checks before M7 closes

1. Connect one Admin identity and verify `get_identity_context` reports the expected subject, role, login, and Project membership.
2. Verify Admin Project read succeeds and a controlled non-destructive Status/Priority write succeeds with post-write verification and actor-aware audit.
3. Connect one Member identity. Verify read succeeds, Status/Priority write succeeds, and generic field mutation is denied.
4. Connect one Viewer identity. Verify Project read succeeds and write attempts are denied.
5. Verify a principal without the target Project in `projectIds` cannot read or write it.
6. Verify `get_my_work` uses the authenticated `githubLogin` and rejects a different login override.
7. Inspect audit output and confirm individual `actorId` is present without any credential material.
8. Only after the individual identity path is validated, remove legacy shared-team write authorization.

## Current deployment-tool limitation

The available deployment connector in this workspace can inspect runtime logs but does not expose environment-variable mutation. Therefore `MCP_OAUTH_IDENTITIES_JSON` must be configured directly in the deployment settings or through another authorized environment-management path. M7 must not be marked complete until that deployment configuration and live role validation are confirmed.
