# M10-5 Bulk Preview → Approval → Apply

M10-5 prevents an operator from turning a multi-item intention directly into a
series of GitHub mutations. Its first slice supports only exact Status/Priority
updates for 1–20 items in one authorized Project. Relationship writes, Issue or
Project-item creation, rollback, cancellation and partial resume are excluded.

## Flow and tools

```text
preview_github_project_bulk_updates
  -> immutable durable artifact + planId + SHA-256 planDigest
approve_github_project_bulk_plan
  -> explicit approval event (same creating admin is allowed in M10-5)
apply_github_project_bulk_plan
  -> full preflight -> single-use claim -> sequential verified writes
get_github_project_bulk_plan
  -> current state, events and per-item results
```

Preview performs no GitHub mutation. It resolves the Project, authorizes every
underlying operation, resolves exact field options, and captures the field ID plus
current and target option IDs/names. Duplicate item/field pairs are rejected. The immutable
artifact contains Project identity, `createdBy`, timestamps and ordered operations;
its canonical JSON is SHA-256 hashed. Approval and Apply both require the plan ID
and digest. Mutable lifecycle state is outside the hashed artifact.

Plans expire 15 minutes after creation. Durable Production storage reuses the
existing M10 Upstash configuration under the isolated
`gyuniverse:m10:bulk-plan:v1:*` namespace; local development uses memory. Stored
payloads and their digest are validated on read. Terminal records remain bounded
by Redis expiry for post-operation inspection.

## State and authorization

```text
previewed -> approved -> applying -> completed
    |           |            |-----> partial
    |           |            `-----> failed
    `-> expired `-> expired
```

Preflight rejection transitions an approved plan directly to terminal `failed`
with zero writes. M10-6 now adds explicit `bulk.preview`, `bulk.approve` and
`bulk.apply` checks on top of authenticated Project access, global write gate,
explicit allowlists and underlying Status/Priority permissions. The default
`same_admin_allowed` mode preserves the original individual workflow; optional
`distinct_admin_required` separates creator and approver. Creator, approver and
applier IDs remain explicit in durable events.

CAS-protected state changes make approval and Apply single-use across serverless
instances. Duplicate Apply on a terminal plan returns the existing result without
mutating. An `applying` plan is never automatically retried. There is no automatic
rollback or partial resume.

## Preflight and runtime failure boundary

Apply first re-resolves the Project, reauthorizes every operation, then re-reads
all items and target options before claiming the plan. Current option ID/name,
field ID and target option ID/name must exactly match the preview. Any stale, permission,
membership, Project or option failure records a plan-level failure and performs
zero mutations.

Only after all checks pass does an atomic `approved -> applying` transition permit
the first mutation. Each write repeats its expected field, before-option and
target-option checks to narrow the race between preflight and GitHub mutation,
then re-reads and verifies the result.
If an external/runtime failure occurs after execution starts, remaining operations
are not attempted. The terminal state is `failed` when the first item fails and
`partial` when an earlier item completed/no-changed. This is orchestration, not a
transaction across GitHub APIs.

## Audit and bounded metadata

Each attempted item uses the existing durable write audit and adds only optional
`planId` correlation. Old audit entries without `planId` remain readable. Plan
storage carries bounded lifecycle events for `preview_created`, `approved`,
`apply_started` and its terminal outcome, including separate actor/timestamps.
Neither store accepts raw mutation payloads, tokens, OAuth secrets, cookies,
authorization headers or arbitrary request metadata.

## Production validation after review and merge

1. Confirm Preview is Ready and all four tools appear in raw authenticated
   Production `tools/list`.
2. As an Admin on a disposable/safe Project fixture, preview two reversible
   Status/Priority changes. Confirm GitHub remains unchanged before approval.
3. Approve with the exact digest, alter one current value independently, and
   confirm Apply reports stale/failed with zero plan writes. Restore the fixture.
4. Create a fresh plan, approve/apply it, and confirm per-item verification,
   `planId` audit correlation, plan events and terminal `completed` state.
5. Reapply the same plan and confirm no GitHub mutation or new audit entry.
6. Confirm the durable plan and item audits survive a later request/serverless
   instance and Production redeploy. Restore every fixture value.
7. Exercise Member/Viewer denial and expired/wrong-digest rejection. Do not force
   a Production runtime partial failure; automated tests cover that boundary.

No Production mutation, merge, rollback or partial resume is authorized by this
implementation task.
