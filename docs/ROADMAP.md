# Roadmap — M1 to AI Project Operator

| Milestone | Status | Goal |
|---|---|---|
| M1 Local Projects MCP | Complete | Read / Snapshot / guarded write / CI |
| M2 Workflow Intelligence | Complete | Resolver / Gap / Reconciliation / Checkpoint / Audit |
| M3 Remote MCP + OAuth | Complete | HTTP / OAuth / PKCE / Vercel / Upstash |
| M3 ChatGPT Live Read | Complete | Connector OAuth + real Project read |
| M4 Project Operating Foundation | Complete | Priority / Views / Native automation / no-sprint continuous flow |
| M5 Shared Core | Complete | Separate transport from business logic |
| M6 High-level Read | Complete | Brief / My Work / Backlog / Review / Blockers / Changes |
| M7 Identity Foundation | Complete | Individual identity + permission model |
| M8 High-level Write | Complete | Semantic write + idempotency + verify + audit |
| M9 REST / GPT Actions | Complete | Operator GPT read/write adapter |
| M10 Advanced Governance | In progress | Durable state / Bulk / Sub-issue / Dependency |

## M4 ✅
- [x] Inspect Project #2 and preserve Priority P0 / P1 / P2 / P3
- [x] Add safe inspection, dry-run, API apply, and verification code
- [x] Decide **not to use Sprint / Iteration** for the initial operating model
- [x] Update M4 apply so Iteration is optional and disabled by default
- [x] Create/verify Backlog / Active Work / My Work / Review Queue / Workstream views
- [x] Enable/verify Issue closed -> Done and PR merged -> Done
- [x] Validate canonical repo auto-add -> Backlog
- [x] Validate Draft -> Ready for review -> In Review
- [x] Validate Close / Merge -> Done without changing Priority
- [x] Rename Project #2 from provisional `LOV WBS` to `Bid Change Validator · WBS`
- [x] Synchronize the code-level target title guard with the renamed Project
- [x] Document repository transition: three temporary weekend parallel repos -> canonical `bid-change-validator` repo with `develop` + feature branches
- [x] Retain write-capable operator development posture with existing safety gates; final per-user authorization moves to M7 Identity / ACL

Repository lifecycle:

```text
Phase 1 · weekend parallel development
├── bid-change-validator-frontend
├── bid-change-validator-backend
└── bid-change-validator-llm-rag
              ↓
Phase 2 · integrated product
bid-change-validator
├── main
└── develop
    └── feature/*
```

`Bid Change Validator · WBS` remains the single Project work-management layer across both phases.

See `M4_PROJECT_OPERATING_FOUNDATION.md` and `M4_PROJECT_UI_SETUP.md`.

## M5 ✅
Shared Core extraction was completed incrementally without rewriting the working MCP adapter.

### Completed boundaries
- [x] `ProjectService`: Project owner / node-ID allowlist boundary and core Project reads
- [x] `SnapshotService`: normalized snapshot access and bounded coverage metadata
- [x] `WorkflowService`: state-gap, reconciliation, and brief-context analysis contracts
- [x] `WorkItemService`: Issue/PR URL resolution and Project membership lookup
- [x] `WritePolicy`: shared server-level mutation authorization boundary
- [x] `AuditService`: shared mutation audit ownership
- [x] `ProjectMutationService`: generic Project item add/update mutation orchestration
- [x] Route migrated MCP read, analysis, resolver, and generic mutation paths through Shared Core
- [x] Preserve existing MCP tool names and external contracts during migration
- [x] Preserve write gates, explicit Project allowlist, verification, and audit behavior
- [x] Keep individual identity / ACL explicitly deferred to M7 instead of treating it as complete

Current architecture:

```text
MCP adapter
   ├─ ProjectService
   ├─ SnapshotService
   ├─ WorkflowService
   ├─ WorkItemService
   └─ ProjectMutationService
          ├─ WritePolicy
          └─ AuditService

future REST / GPT Actions adapter
   └──────────── uses the same Shared Core ────────────┘
```

M5 rule remains authoritative: do not build REST -> MCP -> GitHub or MCP -> REST -> GitHub. Both adapters call Shared Core directly.

## M6 ✅
High-level semantic reads are implemented in Shared Core and exposed through thin MCP tools. Results stay evidence-based and preserve the snapshot/checkpoint coverage boundary.

- [x] `get_project_brief`
- [x] `get_my_work`
- [x] `get_backlog`
- [x] `get_review_queue`
- [x] `get_unassigned_work`
- [x] `get_blockers`
- [x] `get_project_changes`

M6 rules:
- do not infer Done from assignment, intention, or open PR state
- do not infer a blocker merely from missing assignment or ordinary workflow status
- preserve item URL/repository/number/status/priority/assignees as evidence
- keep snapshot reads bounded by normalized snapshot coverage until pagination is expanded
- checkpoint storage may be durable in M10 Production; local development may remain process-local

## M7 ✅
Authentication -> Identity -> Membership -> Role/Permission -> Operation Policy

### Completed
- [x] Add `AuthenticatedPrincipal`, `ProjectRole`, and `ProjectPermission` models
- [x] Define Admin / Member / Viewer permission matrix
- [x] Add `IdentityPolicy` permission checks
- [x] Make `WritePolicy` principal-aware while retaining existing server write gate and Project allowlist
- [x] Pass OAuth request principal into the Shared Core write boundary
- [x] Add `MCP_OAUTH_IDENTITIES_JSON` registry for individual OAuth subjects, roles, GitHub login, and Project memberships
- [x] Bind individual access codes to stable OAuth subjects during authorization
- [x] Enforce per-principal Project membership before writes
- [x] Propagate actor identity into mutation audit records
- [x] Make authenticated identity authoritative for `get_my_work`
- [x] Apply principal `project.read` + Project membership to reads/snapshots/analysis
- [x] Validate Admin / Member / Viewer live behavior
- [x] Remove legacy shared-team write authorization; compatibility subject is read-only only

Current permission baseline:
- Admin: Project read/write + create/add/assign + generic field/status/priority/relationship writes + bulk Preview/Approve/Apply
- Member: Project read/write + add item + status/priority writes; no create/assign/unrestricted generic field mutation
- Viewer: Project read-only

## M8 ✅
High-level semantic writes are implemented in Shared Core and exposed through MCP.

- [x] `captureBacklog`
- [x] `createWorkItem`
- [x] `assignWorkItem`
- [x] `startWork`
- [x] `updateWorkItemStatus`
- [x] `updateWorkItemPriority`
- [x] Pre-authorize operation chains before first mutation where multiple permissions are required
- [x] Preserve idempotency for status/priority/start/assign/capture paths
- [x] Return same-operation actor-aware audit metadata
- [x] Validate `createWorkItem` in Production: Issue create -> Project capture -> Backlog -> verification
- [x] Fix stale post-add Project-list false negative by using the add mutation's Project item node ID and direct exact-item verification

Iteration-specific write is not part of the initial Project #2 operating model.

## M9 ✅
Semantic REST/GPT Actions adapter is complete and uses the same Shared Core as MCP.

### Completed
- [x] M9-1 OAuth-protected REST read adapter
- [x] M9-1 public OpenAPI 3.1 discovery document
- [x] M9-1 Vercel routing + Production smoke test
- [x] M9-2 REST write adapter backed directly by `HighLevelWriteService`
- [x] M9-3 OpenAPI write operations with `projects:read` + `projects:write`
- [x] M9-4 Action-safe error envelope with `category / retryable / userAction`
- [x] M9-4 Explicit no-auto-retry guidance for `CREATE_WORK_ITEM_PARTIAL_FAILURE`
- [x] M9-4 Re-read-before-retry guidance for ambiguous verification failures
- [x] M9-5 Add confidential OAuth client compatibility for Custom GPT Actions
- [x] M9-5 Support ChatGPT `/aip/g-.../oauth/callback` redirect patterns while preserving Remote MCP callback rules
- [x] M9-5 Add GPT Actions OAuth/live-validation runbook without storing client secrets
- [x] Configure Production GPT Actions OAuth client and verify confidential token-auth metadata
- [x] Import `/openapi.json` into the Custom GPT editor; fix `components.schemas` editor compatibility
- [x] Validate individual Admin identity read through Custom GPT Actions
- [x] Validate Project read through Custom GPT Actions
- [x] Validate safe no-change Status write with `verified=true`, correct `actorId`, audit metadata, and read-after-write consistency
- [x] Validate Member role denial for `assignWorkItem`: `PERMISSION_DENIED`, authorization category, non-retryable, no mutation
- [x] Confirm Production returned HTTP 403 for denied `/api/v1/write/assign` requests

Production validation boundary:
- Admin subject: `user:admin-validation`
- Member subject: `user:member-validation`
- Project: `PVT_kwDOEzfCi84BidwG`
- Safe test item: Issue #10 / `PVTI_lADOEzfCi84BidwGzg5ouUc`
- No OAuth access codes, client secrets, bearer tokens, or signing secrets are stored in docs.

M9 architecture rule remains authoritative:

```text
MCP adapter  ─┐
              ├─ Shared Core ── GitHub GraphQL
REST adapter ─┘
```

REST must not call MCP and MCP must not call REST.

## M10 🟡
Advanced Governance is implemented in bounded slices rather than one large mutation surface.

### M10-1 Durable checkpoint
- [x] Add checkpoint persistence abstraction
- [x] Add namespaced Upstash latest-baseline storage
- [x] Reuse existing Production Upstash credentials when OAuth replay already uses Upstash
- [x] Preserve explicit/local memory fallback
- [x] Validate restored baseline across independent service instances in tests
- [x] Return persistence kind and restart-survival metadata
- [x] Production cross-request/redeploy validation

### M10-2 Durable write audit
- [x] Replace direct process-local audit ownership with a storage abstraction
- [x] Reuse the governance Upstash deployment under an isolated audit namespace
- [x] Preserve bounded newest-first retention and Project/item filters
- [x] Fail closed on malformed stored payloads and audit persistence failures
- [x] Cover memory, cross-instance restore, ordering, retention, filtering, and secret exclusion
- [x] Production cross-request/redeploy validation (PR #41; operator handoff evidence in M10 documentation)

### M10-3 Dependency / sub-issue reads
- [x] Dedicated read-only MCP tool backed by Shared Core
- [x] Native parent, sub-issue, blocks and blocked-by evidence
- [x] Project/principal authorization, same-Project detail filtering and bounded coverage
- [x] Regression tests; existing snapshot and blocker semantics preserved
- [x] Production raw tools/list and Issue #4 relationship read validation (viewer PKCE; complete empty result)

### M10-4 Guarded relationship writes
- [x] Four explicit single-edge native operations; no bulk or reparenting
- [x] Admin-only relationship permission, existing write gates and same-Project endpoint resolution
- [x] Bounded cycle/precondition checks and fresh normalized reciprocal verification
- [x] Durable success/no-change/failure audit with bounded relationship metadata
- [x] Core, HTTP MCP authorization/registration and durable audit regressions
- [x] Reviewed Production add/remove/no-change, cleanup and redeploy validation (operator handoff evidence)

### M10-5 Bulk Preview → Approval → Apply
- [x] Single-Project Status/Priority plans bounded to 20 operations
- [x] Immutable digest-bound Preview with durable 15-minute plan storage
- [x] Explicit same-Admin approval with separate creator/approver events
- [x] Full all-item preflight before the single-use Apply claim
- [x] Stale/precondition failure guarantees zero plan mutations
- [x] Verified per-item writes with durable `planId` audit correlation
- [x] Terminal completed/failed/partial representation; no retry, rollback or resume
- [x] Local persistence, cross-instance CAS and fail-closed validation regressions
- [x] Review and Production validation (two-item apply/audit, duplicate no-op, cleanup, stale zero-write, redeploy restore)

### M10-6 Richer ACL
- [x] Preserve Viewer/Member/Admin defaults while enforcing explicit operation capabilities
- [x] Add `bulk.preview`, `bulk.approve`, and `bulk.apply` capability boundaries
- [x] Allow identity permission snapshots to narrow, never expand, role defaults
- [x] Require owner allowlist, Project allowlist, identity membership and capability intersection for authenticated access
- [x] Keep tool discovery separate from fail-closed runtime authorization
- [x] Add default same-Admin and optional distinct-Admin maker-checker policies
- [x] Recheck current approver/applier and underlying item capabilities before mutation
- [x] Preserve bounded durable audit compatibility with optional capability metadata
- [x] Local ACL, maker-checker, tool-exposure and M10 regression coverage
- [ ] Review and Production validation

### Remaining
- [x] M10-4 review / Production validation and close
- [x] M10-5 review / Production validation and close
- [ ] M10-6 review / Production validation and close
- [ ] M10-7 Production validation / milestone close

Iteration remains optional and is not reintroduced into Project #2 unless the operating model changes explicitly.

See `M10_ADVANCED_GOVERNANCE.md` and `M10_RELATIONSHIP_WRITES.md`.

## Product direction
Build an AI Project Operator, not a generic wrapper around every GitHub Projects API.
