# M10 Advanced Governance closeout

M10 Advanced Governance is complete. This closeout records the bounded final
Production regression performed after PR #48 and does not add a mutation or
change Production configuration.

## Milestone summary

| Slice | Outcome |
|---|---|
| M10-1 Durable checkpoint | Production validated |
| M10-2 Durable write audit | Production validated |
| M10-3 Dependency / sub-issue read | Production validated |
| M10-4 Guarded relationship write | Production validated |
| M10-5 Bulk Preview → Approval → Apply | Production validated |
| M10-6 Richer ACL | Production validated |
| M10-7 Production validation / close | Complete |

## Final Production evidence

- PR #48 merge `80bc8fa` was the latest `main` revision and its matching Vercel
  Production deployment `dpl_Bcgsq6gYKRarEJAVo6nK4xzG3mSD` was `READY`.
- An unauthenticated `POST /mcp` returned the expected `401` Bearer challenge,
  OAuth protected-resource metadata URL, and `projects:read projects:write`
  scope. Authenticated Project, identity, audit, and checkpoint calls succeeded.
  Vercel reported no `/mcp` runtime error clusters in the checked one-hour window.
- `user:admin-validation` remained an Admin for
  `PVT_kwDOEzfCi84BidwG`, with `githubLogin=4hglee-ops` and all relationship and
  bulk capabilities. `gyuniverse-hq` Project #2 resolved successfully, preserving
  the actor/Project-owner distinction.
- Issues #8 and #9 were both `Backlog`. A separate read-only GitHub GraphQL check
  returned `parent=null`, zero sub-issues, zero blocking and zero blocked-by
  relationships for both, with complete first-page coverage. No cleanup write was
  required.

## Tool exposure

The deployed server builder registers the complete M10 surface:

- `create_github_project_state_checkpoint`
- `compare_github_project_state_checkpoint`
- `list_github_project_write_audit_log`
- `get_github_project_item_relationships`
- `add_github_project_sub_issue`
- `remove_github_project_sub_issue`
- `add_github_project_blocked_by`
- `remove_github_project_blocked_by`
- `preview_github_project_bulk_updates`
- `approve_github_project_bulk_plan`
- `apply_github_project_bulk_plan`
- `get_github_project_bulk_plan`

The same `buildMcpServer` path serves Production, and the 236-test suite exercises
HTTP/MCP `tools/list`, relationship registration, bulk registration, and runtime
authorization. Earlier M10-3 through M10-5 Production validation established raw
tool exposure. The Codex app connection used for this closeout retained an older
discovery cache and could not produce a fresh raw catalog dump; this is recorded
as a client-catalog limitation rather than treated as authorization evidence.
Tool visibility is never the security boundary: every operation is authorized at
runtime.

## Durability evidence

The existing checkpoint created at `2026-09-06T12:49:18.491Z` remained readable
without replacement. Its store reported `kind=upstash` and
`survivesServerRestart=true`; the comparison completed with full current and
baseline coverage.

The audit store also reported `persistence=upstash` and
`survivesServerRestart=true`. The final read restored all requested representative
records:

- relationship: `write-0036f1ed-9e32-412b-a90a-4f1837293384`,
  `write-26ed643d-a71e-4fec-bef4-6f253e807914`
- successful bulk apply: `write-7111d3f4-12b7-4ee5-8824-f40e7e41150f`,
  `write-4d393396-ae38-4598-87b0-a2f63e1017cc`
- bulk cleanup: `write-f62efc90-a7f4-4e9f-922b-edbdb5eaa281`,
  `write-1770cc2e-00b1-49e8-84a9-de6dc635f1e2`

Accepted M10-5 Production evidence retains these terminal plan outcomes; none was
re-applied during closeout:

- `bulk-plan-de26f297-19b1-4e16-8969-d10eb8853423`: `completed`
- `bulk-plan-51b692d5-3393-4a50-bef2-d4ba307f6bb1`: `completed`
- `bulk-plan-13bfc8d5-b289-4700-a8c0-deb8fbc9c452`: `failed`,
  `errorCode=PLAN_STALE`, `applyStartedAt=null`, `results=[]`

The connected app discovery cache prevented a new direct bulk-plan tool call in
this closeout. Current Upstash audit restoration after the subsequent PR #47 and
#48 deployments confirms that the durable namespace and plan correlations did not
regress; the terminal plan details above remain accepted M10-5 evidence.

## Final governance architecture

```text
OAuth identity and scope
  -> owner allowlist
  -> Project allowlist
  -> identity Project membership
  -> operation capability
  -> global write gate for mutation
  -> precondition / full bulk preflight
  -> GitHub mutation
  -> normalized re-read verification
  -> bounded durable audit / plan state
```

Project owner and authenticated actor are independent identities. Tool discovery
does not grant permission, and no plan or checkpoint stores a credential snapshot.

## Final ACL matrix

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

Identity permission snapshots may narrow but cannot expand these role defaults.

## Bulk safety guarantees

- One Project, Status/Priority only, 1–20 operations.
- Immutable SHA-256 digest-bound, expiring durable Preview plan.
- Explicit approval with distinct creator and approver events.
- Full all-item authorization and stale-value preflight before any mutation.
- Preflight failure performs zero writes; only runtime external failure may be
  terminally partial.
- Compare-and-set single-use Apply; no automatic retry, rollback, or resume.
- Per-item re-read verification and durable `planId` audit correlation.
- Optional `distinct_admin_required` maker-checker policy, rechecked before Apply.

## Security regression status

The full suite passed 236/236. It covers owner and Project allowlists, identity
Project membership, capability checks, the global write gate, runtime ACL despite
tool visibility, bounded persistence schemas, and credential exclusion. Tests
also cover no PAT/token/OAuth code/client secret/cookie/Authorization-header
persistence or diagnostic leakage. Typecheck and both builds passed.

## Non-blocking deferred validation

- Viewer role-specific Production OAuth smoke.
- Member role-specific Production OAuth smoke.
- Real two-Admin `distinct_admin_required` Production smoke.

Do not create temporary real users solely for these checks. They should be run
when suitable identities already exist and can be performed without broadening
Production access.

## Known limitations and operations

- Bulk plans do not support relationship writes, rollback, or partial resume.
- Relationship operations remain bounded single-edge writes with no reparenting.
- Durable audit is operational evidence, not an external compliance/SIEM archive.
- App clients may cache MCP discovery; validate the raw authenticated catalog when
  diagnosing exposure, while continuing to rely on runtime ACL for security.
- Keep Upstash health, write/audit failure alerts, allowlists, OAuth identity
  membership, and least-privilege capability snapshots under operational review.
- Re-run a safe checkpoint compare and representative durable reads after material
  runtime/storage migrations. Do not manufacture Production mutations for routine
  health checks.

M11 is not started by this closeout.
