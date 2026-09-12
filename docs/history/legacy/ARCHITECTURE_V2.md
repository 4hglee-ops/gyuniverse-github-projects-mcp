# Architecture V2 — Shared Core & Dual Adapter

## Goal
Preserve the working Remote MCP read path while evolving the project into a shared GitHub Projects gateway for MCP and REST/GPT Actions.

## Final Architecture

```text
Team Member
   ├─ ChatGPT ── Remote MCP (main read/analysis) ─┐
   │          └─ Operator GPT / REST Actions ─────┤
   └─ Claude / Code ── MCP (read/write) ──────────┤
                                                   ↓
                                           Shared Core
                                                   ↓
                                Identity / Permission / Safety
                                                   ↓
                                  GitHub Projects + Issues/PR
```

## Architecture rules
- Do not build REST -> MCP -> GitHub.
- Do not build MCP -> REST -> GitHub.
- Both adapters call the same Shared Core.
- Adapter code stays transport-only.
- Migrate incrementally; do not rewrite the working MCP in one pass.
- GitHub Projects is the work-management source of truth for this product; Jira is not used in the current operating model.

## Shared Core responsibilities
- Project / field / item resolution
- Snapshot normalization
- Status / Priority semantics
- Work-item / backlog orchestration
- Assignee handling
- State-gap / reconciliation / brief logic
- Project allowlist
- Identity / permission checks
- Idempotency
- Mutation policy
- Re-read verification
- Audit

Iteration remains an optional future capability and is not part of the current no-sprint operating model.

## Product role split
| Layer | Responsibility |
|---|---|
| GitHub UI | Fast visual scanning |
| GitHub native automation | Deterministic repository-event transitions |
| MCP | AI-native read, analysis, reconciliation, guarded tools |
| REST / GPT Actions | Operator GPT and external automation |
| Shared Core | Business logic, permissions, safety, verification, audit |

## Confirmed decisions
- Keep and expand MCP Read.
- Keep MCP write-capable for authorized operator workflows.
- REST is a first-class second adapter.
- Implement business logic once in Shared Core.
- GitHub Projects is the Project/work-management source of truth; Jira is not part of the current stack.
- Multiple authorized users may receive write permissions after Identity / ACL is implemented.
- Destructive delete operations are not exposed initially.
- Bulk / AI-judgment writes use Preview -> explicit approval -> Apply.

## M5 extraction strategy

Start with ProjectService and move MCP reads behind it first. Continue by extracting
SnapshotService / WorkflowService, then WorkItemService and shared write policy. Each
slice must preserve the existing MCP tool contract and tests before the next slice.

```text
MCP adapter ─┐
             ├─> Shared Core services ─> GitHub clients
REST adapter ┘        (future)
```

The MCP adapter must become progressively transport-only instead of remaining the
owner of Project allowlist checks and business orchestration.

## Open decisions
- Individual identity provider
- Durable checkpoint / audit store
- Operator GPT authentication UX
