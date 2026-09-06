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
| M8 High-level Write | Planned | Semantic write + idempotency + verify + audit |
| M9 REST / GPT Actions | Planned | Operator GPT read/write adapter |
| M10 Advanced Governance | Planned | Durable state / Bulk / Sub-issue / Dependency |

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

`Bid Change Validator · WBS` remains the single Project work-management layer across
both phases.

See `M4_PROJECT_OPERATING_FOUNDATION.md` and `M4_PROJECT_UI_SETUP.md`.

## M5 ✅
Shared Core extraction was completed incrementally without rewriting the working MCP
adapter.

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

M5 rule remains authoritative: do not build REST -> MCP -> GitHub or MCP -> REST -> GitHub.
Both adapters call Shared Core directly.

Remaining intentionally later:
- individual Identity / Membership / Role / Permission: M7
- high-level semantic write orchestration and idempotency: M8
- REST / GPT Actions transport adapter: M9
- durable audit/checkpoint persistence: M10

## M6 ✅
High-level semantic reads are implemented in Shared Core and exposed through thin MCP
tools. Results stay evidence-based and preserve the snapshot/checkpoint coverage boundary.

- [x] `get_project_brief`: workflow/priority counts plus active, review, unassigned, and explicit blocker focus
- [x] `get_my_work`: assignee-focused work; explicit GitHub login until M7 identity exists
- [x] `get_backlog`: items with Status = Backlog
- [x] `get_review_queue`: items with Status = In Review
- [x] `get_unassigned_work`: non-completed items with no assignee evidence
- [x] `get_blockers`: explicit Blocked status/fields/reasons only; no blocker inference from ordinary workflow state
- [x] `get_project_changes`: shared process-local checkpoint baseline plus semantic change groups
- [x] Existing checkpoint create/compare tools and `get_project_changes` use the same `ProjectChangeService` baseline

M6 rules:
- do not infer Done from assignment, intention, or open PR state
- do not infer a blocker merely from missing assignment or ordinary workflow status
- preserve item URL/repository/number/status/priority/assignees as evidence
- keep snapshot reads bounded by normalized snapshot coverage until pagination is expanded
- treat entered/left membership deltas as authoritative only when both checkpoint windows are complete
- checkpoint storage remains process-local; durable persistence remains M10

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
- [x] Resolve remote principals from individual subject on each request so role/membership changes take effect without changing adapter contracts
- [x] Enforce per-principal Project membership before writes
- [x] Propagate actor identity into mutation audit records
- [x] Make authenticated identity authoritative for `get_my_work`; login cannot impersonate another identity
- [x] Apply principal `project.read` + Project membership to Project reads, snapshots, high-level reads, analysis, and checkpoint/change paths through `ProjectService`
- [x] Return actor-aware audit metadata directly in Status/Priority write responses for serverless-safe validation
- [x] Validate Admin identity, read, no-change Status write, verification, and `actorId` in Production
- [x] Validate Member identity and no-change Status write in Production
- [x] Validate Member generic field mutation is denied with `PERMISSION_DENIED`
- [x] Validate Viewer Project read succeeds and write is denied with `PERMISSION_DENIED`
- [x] Remove legacy shared-team write authorization; compatibility subject is read-only only

Target role shape:
- Admin / PM: broad Project read/write within policy
- Member: selected writes according to permission policy
- Viewer: read-only

Current permission baseline:
- Admin: Project read/write + add item + generic field/status/priority writes
- Member: Project read/write + add item + status/priority writes; no unrestricted generic field mutation
- Viewer: Project read-only

Individual OAuth identities are configured server-side. Access codes are credentials and
must never be committed, logged, or pasted into project documentation. The registry
stores only the configured identity model at runtime; tokens carry the stable subject,
and role/Project membership are resolved again from the server registry on requests.

Authenticated remote reads fail closed at the shared `ProjectService` boundary when
the principal lacks `project.read` or membership in the target Project. Local/stdio
calls without a principal retain the existing server allowlist behavior for development
compatibility.

The legacy shared-team subject is retained only as a temporary read-only compatibility
path. Possession of the old team code can no longer produce an Admin principal or grant
Project write permissions, even when the OAuth token contains `projects:write`.

Multiple authorized users may receive write permissions through individual identities.
The server credential remains the backend capability; authenticated Identity / ACL decides
which user may invoke which operation.

## M8
High-level writes:
- captureBacklog
- createWorkItem
- assignWorkItem
- startWork
- updateWorkItemStatus
- updateWorkItemPriority

Iteration-specific write is not part of the initial Project #2 operating model.

## M9
Add a semantic REST/GPT Actions adapter that uses the same Shared Core as MCP.

## M10
- Persistent checkpoint
- Durable audit
- Sub-issues
- Dependencies
- Optional future sprint planning
- Bulk Preview -> Approval -> Apply
- richer ACL

## Product direction
Build an AI Project Operator, not a generic wrapper around every GitHub Projects API.
