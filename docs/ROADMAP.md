# Roadmap — M1 to AI Project Operator

| Milestone | Status | Goal |
|---|---|---|
| M1 Local Projects MCP | Complete | Read / Snapshot / guarded write / CI |
| M2 Workflow Intelligence | Complete | Resolver / Gap / Reconciliation / Checkpoint / Audit |
| M3 Remote MCP + OAuth | Complete | HTTP / OAuth / PKCE / Vercel / Upstash |
| M3 ChatGPT Live Read | Complete | Connector OAuth + real Project read |
| M4 Project Operating Foundation | In progress | Priority / Views / Native automation / no-sprint continuous flow |
| M5 Shared Core | Planned | Separate transport from business logic |
| M6 High-level Read | Planned | Brief / My Work / Backlog / Review / Blockers |
| M7 Identity Foundation | Planned | Individual identity + permission model |
| M8 High-level Write | Planned | Semantic write + idempotency + verify + audit |
| M9 REST / GPT Actions | Planned | Operator GPT read/write adapter |
| M10 Advanced Governance | Planned | Durable state / Bulk / Sub-issue / Dependency |

## M4
- [x] Inspect Project #2 and preserve Priority P0 / P1 / P2 / P3
- [x] Add safe inspection, dry-run, API apply, and verification code
- [x] Decide **not to use Sprint / Iteration** for the initial operating model
- [x] Update M4 apply so Iteration is optional and disabled by default
- [x] Create/verify Backlog / Active Work / My Work / Review Queue / Workstream views
- [x] Enable/verify Issue closed -> Done and PR merged -> Done
- [x] Validate canonical repo auto-add -> Backlog
- [x] Validate Draft -> Ready for review -> In Review
- [x] Validate Close / Merge -> Done without changing Priority
- [ ] Rename Project #2 from provisional `LOV WBS` to `Bid Change Validator · WBS`
- [ ] Synchronize the code-level target title guard with the renamed Project
- [ ] Document repository transition: three temporary weekend parallel repos -> canonical `bid-change-validator` repo with `develop` + feature branches
- [ ] Restore PAT / Project permission posture to minimum read-only after M4 writes are complete

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

## M5
Extract shared services incrementally:
- ProjectService
- WorkItemService
- SnapshotService
- WorkflowService
- WritePolicy
- AuditService

## M6
High-level reads:
- get_project_brief
- get_my_work
- get_backlog
- get_review_queue
- get_unassigned_work
- get_blockers
- get_project_changes

## M7
Authentication -> Identity -> Membership -> Role/Permission -> Operation Policy

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
