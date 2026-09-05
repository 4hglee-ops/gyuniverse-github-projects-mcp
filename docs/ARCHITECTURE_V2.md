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

## Shared Core responsibilities
- Project / field / item resolution
- Snapshot normalization
- Status / Priority / Iteration semantics
- Work-item / backlog orchestration
- Assignee handling
- State-gap / reconciliation / brief logic
- Project allowlist
- Identity / permission checks
- Idempotency
- Mutation policy
- Re-read verification
- Audit

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
- REST is a first-class second adapter.
- Implement business logic once in Shared Core.
- Destructive delete operations are not exposed initially.
- Bulk / AI-judgment writes use Preview -> explicit approval -> Apply.

## Open decisions
- Individual identity provider
- Durable checkpoint / audit store
- Jira vs GitHub Projects source-of-truth policy
- Operator GPT authentication UX
