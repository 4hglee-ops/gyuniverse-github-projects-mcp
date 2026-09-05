# Security & Permission Model — Identity / ACL / Write Safety

## Current limitation
`MCP_OAUTH_TEAM_CODE` is a team-level approval gate and does not identify individual users.

## Target authorization chain

```text
Authentication
  -> User Identity
  -> Project Membership
  -> Role / Permission
  -> Operation Policy
  -> Write Guard
  -> GitHub Mutation
```

## Permission model
Roles are permission bundles; operation permissions are the enforcement primitive.

```text
project.read
backlog.create
item.create
item.update_status
item.update_priority
item.assign_self
item.assign_any
iteration.update
bulk.preview
bulk.apply
```

| Capability | Admin / PM | Member | Viewer |
|---|---|---|---|
| Read | yes | yes | yes |
| Backlog / item create | yes | yes | no |
| Assign self | yes | yes | no |
| Assign others | yes | policy-based | no |
| Status / Priority | yes | yes | no |
| Iteration | yes | policy-based | no |
| Bulk apply | yes | no | no |
| Delete / project settings | disabled initially | no | no |

## Write risk levels
- Level 1: safe single mutation -> permission + validation + verify + audit
- Level 2: coordinating mutation -> stronger permission checks
- Level 3: bulk / AI judgment -> Preview -> explicit approval -> Apply
- Destructive: not exposed in v1

## Defense in depth

```text
Client confirmation
+ Authenticated User Identity
+ Server ACL
+ Project allowlist
+ Operation policy
+ Idempotency
+ Re-read verification
+ Audit
```

## Idempotency
Support `Idempotency-Key` or a server request ID so retries do not duplicate writes.

## OAuth client separation
Use separate client policy for:
- chatgpt-mcp
- claude-mcp
- chatgpt-actions
