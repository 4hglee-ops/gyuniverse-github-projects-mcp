# Roadmap — M1 to AI Project Operator

| Milestone | Status | Goal |
|---|---|---|
| M1 Local Projects MCP | Complete | Read / Snapshot / guarded write / CI |
| M2 Workflow Intelligence | Complete | Resolver / Gap / Reconciliation / Checkpoint / Audit |
| M3 Remote MCP + OAuth | Complete | HTTP / OAuth / PKCE / Vercel / Upstash |
| M3 ChatGPT Live Read | Complete | Connector OAuth + real Project read |
| M4 Project Operating Foundation | Next | Priority / Iteration / Views / Native automation |
| M5 Shared Core | Planned | Separate transport from business logic |
| M6 High-level Read | Planned | Brief / My Work / Backlog / Review / Blockers |
| M7 Identity Foundation | Planned | Individual identity + permission model |
| M8 High-level Write | Planned | Semantic write + idempotency + verify + audit |
| M9 REST / GPT Actions | Planned | Operator GPT read/write adapter |
| M10 Advanced Governance | Planned | Durable state / Bulk / Sub-issue / Dependency |

## M4
- Priority: P0 / P1 / P2 / P3
- Iteration: Current Sprint
- Views: Backlog / Current Sprint / My Work / Review Queue / Workstream
- Native automation:
  - Issue closed -> Done
  - PR merged -> Done
  - PR ready for review -> In Review
  - Issue/PR auto-add -> Project #2

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
- updateWorkItemIteration

## M9
Add a semantic REST/GPT Actions adapter that uses the same Shared Core as MCP.

## M10
- Persistent checkpoint
- Durable audit
- Sub-issues
- Dependencies
- Sprint planning
- Bulk Preview -> Approval -> Apply
- richer ACL

## Product direction
Build an AI Project Operator, not a generic wrapper around every GitHub Projects API.
