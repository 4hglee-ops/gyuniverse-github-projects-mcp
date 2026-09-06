# M10-6 Richer ACL

M10-6 makes the existing role model explicitly capability-driven and
Project-scoped without adding business mutations. Roles remain stable bundles for
compatibility; capabilities are the runtime enforcement primitive.

## Default matrix

| Capability | Admin | Member | Viewer |
|---|---:|---:|---:|
| `project.read` | yes | yes | yes |
| `project.write` | yes | yes | no |
| `item.add` | yes | yes | no |
| `item.update_status` | yes | yes | no |
| `item.update_priority` | yes | yes | no |
| `item.create` | yes | no | no |
| `item.assign` | yes | no | no |
| `item.update_field` | yes | no | no |
| `item.relationship.write` | yes | no | no |
| `bulk.preview` | yes | no | no |
| `bulk.approve` | yes | no | no |
| `bulk.apply` | yes | no | no |

Existing names such as `project.write`, `item.update_status`,
`item.update_priority` and `item.relationship.write` remain authoritative. They
are not renamed or silently migrated. M10-6 only adds the three explicit bulk
capabilities.

`MCP_OAUTH_IDENTITIES_JSON` may optionally specify `permissions` for an identity.
The array is a snapshot that may only narrow the selected role's defaults. Unknown
permissions and attempts to expand a role fail configuration loading. Omitting the
array preserves the pre-M10-6 role behavior.

Example shape (never commit real access codes):

```json
{
  "subject": "user:approval-example",
  "accessCode": "<deployment-secret>",
  "role": "admin",
  "projectIds": ["PVT_example"],
  "permissions": ["project.read", "project.write", "bulk.approve"]
}
```

## Effective Project authorization

Authenticated access is allowed only when all relevant boundaries agree:

```text
authenticated identity
  ∩ explicit server owner allowlist
  ∩ explicit server Project allowlist
  ∩ identity projectIds membership
  ∩ operation capability
  ∩ global write gate and OAuth write scope for mutations
```

Authenticated reads fail closed when either server allowlist is empty. Writes
continue to require the same explicit Project node-ID allowlist. A capability held for
an identity cannot cross into a Project absent from that identity's `projectIds`.
The actor's `githubLogin` supports actor-bound workflows such as My Work; it never
replaces the requested Project owner.

Tools remain visible for discovery. Runtime Shared Core checks are the security
boundary, so a visible write or bulk tool still returns a bounded authorization
error when the current principal lacks permission.

## Bulk maker-checker modes

`M10_BULK_APPROVAL_MODE` accepts:

- `same_admin_allowed` (default): creator self-approval remains valid and a
  different authorized Admin may also approve.
- `distinct_admin_required`: creator self-approval returns
  `DISTINCT_APPROVER_REQUIRED`; a different authorized Admin must approve.

Preview requires `bulk.preview` and every underlying Status/Priority capability.
Approval requires current Project access and `bulk.approve`. Apply requires
current Project access, `bulk.apply`, and every underlying item-write capability.
Creator, approver and applier may therefore be three different authorized Admins.
Their IDs are preserved separately in immutable plan ownership and lifecycle
events.

Preview, Approval and Apply each resolve the Project and evaluate the current
principal. Apply repeats all capability checks immediately before preflight and
before the first mutation. Permission removed after Preview or Approval therefore
leaves the plan non-executable; no credential or permission snapshot is stored in
the durable artifact.

## Errors and audit

Existing stable failures remain compatible: `IDENTITY_REQUIRED`,
`PERMISSION_DENIED`, `PROJECT_MEMBERSHIP_DENIED`, owner/Project allowlist errors
and write-gate errors. M10-6 adds `OWNER_ALLOWLIST_REQUIRED`, `CAPABILITY_REQUIRED`,
`PROJECT_ALLOWLIST_REQUIRED` and `DISTINCT_APPROVER_REQUIRED`. Errors contain bounded actor/permission/Project
identifiers and never raw OAuth or GitHub responses.

Durable write entries now optionally record the validated capability name.
Legacy entries without it remain readable. The allowlisted schema still excludes
tokens, access codes, client secrets, Authorization headers, cookies and raw
credential/request payloads.

## Production closeout

M10-6 is Production-validated and complete. PR #47 merge `a24764b` reached a
matching `READY` Production deployment. The Production Admin identity exposed all
relationship and bulk capabilities, read the allowlisted `gyuniverse-hq` Project
#2 with actor login `4hglee-ops`, and retained access to durable Upstash audit,
checkpoint, and bulk correlation evidence. The closeout intentionally performed
no relationship mutation and no bulk Apply.

The 236-test suite covers Viewer/Member runtime authorization and existing Member
single-item compatibility. Direct Viewer/Member Production OAuth reconnection was
not available during the minimal smoke and is recorded for M10-7 follow-up rather
than treated as an M10-6 blocker.

## Deliberate exclusions

No role-management UI, arbitrary custom roles, external IAM, organization sync,
dynamic delegation, bulk relationship writes, rollback/resume, or new mutation
types are introduced. Viewer/Member role-specific Production OAuth smoke,
distinct-Admin two-identity validation, and final milestone closure remain M10-7
work.
