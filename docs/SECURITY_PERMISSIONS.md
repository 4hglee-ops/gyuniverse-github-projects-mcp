# Security & Permission Model — Identity / ACL / Write Safety

## Identity baseline

Individual OAuth identities are authoritative. The legacy team-code subject is
read-only and does not receive write or bulk capabilities.

## Authorization chain

```text
Authentication
  -> User Identity
  -> Owner / Project allowlists
  -> Project Membership
  -> Operation Capability
  -> Write Guard
  -> GitHub Mutation
```

Roles are migration-compatible permission bundles; operation capabilities are the
runtime enforcement primitive.

| Capability | Admin | Member | Viewer |
|---|---:|---:|---:|
| `project.read` | yes | yes | yes |
| `project.write` | yes | yes | no |
| `item.add` | yes | yes | no |
| `item.update_status` / `item.update_priority` | yes | yes | no |
| `item.create` / `item.assign` / `item.update_field` | yes | no | no |
| `item.relationship.write` | yes | no | no |
| `bulk.preview` / `bulk.approve` / `bulk.apply` | yes | no | no |

An OAuth identity may include an explicit `permissions` array to narrow its role
bundle. Overrides cannot add a permission absent from the role default, so they do
not elevate Viewer or Member.

Every authenticated Project decision intersects the server owner allowlist,
explicit Project allowlist, identity `projectIds` membership and operation
capability. Authenticated access fails closed when either allowlist is empty.
`githubLogin` is actor identity only and is never used as Project owner.

Bulk approval defaults to `same_admin_allowed`.
`M10_BULK_APPROVAL_MODE=distinct_admin_required` rejects creator self-approval;
another authorized Admin with `bulk.approve` and Project access may approve. The
Apply actor may differ and must independently hold `bulk.apply` and all underlying
item-write capabilities. Durable plans never preserve old authority.

## Write risk levels

- Level 1: safe single mutation -> capability + validation + verify + audit
- Level 2: coordinating mutation -> stronger capability checks
- Level 3: bulk / AI judgment -> Preview -> explicit approval -> Apply
- Destructive: not exposed in v1

## Defense in depth

```text
Client confirmation
+ Authenticated User Identity
+ Server ACL
+ Owner and Project allowlists
+ Project membership
+ Operation capability
+ Idempotency
+ Re-read verification
+ Durable audit
```

## OAuth client separation

OAuth configuration remains separated for ChatGPT MCP, Claude MCP and GPT
Actions. Client type does not change Project ACL: every transport resolves the
same bounded principal and Shared Core policy.
