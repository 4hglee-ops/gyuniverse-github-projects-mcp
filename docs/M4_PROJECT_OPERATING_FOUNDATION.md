# M4 Project Operating Foundation

## Scope

M4 establishes the operating surface for `gyuniverse-hq` Project #2, `LOV WBS`
(`PVT_kwDOEzfCi84BidwG`). It preserves the existing Priority field and adds only
missing, explicitly approved structure.

## Operating model

The team will use **GitHub Projects as the primary development work-management system**
and will **not use Sprint / Iteration for the initial operating model**.

The Project therefore follows a lightweight continuous-flow / Kanban-style model:

```text
Backlog -> Todo -> In Progress -> In Review -> Done
```

Work is prioritized with `Priority`, assigned with GitHub Assignees, and tracked by
Status and Repository. There is no weekly Sprint boundary to maintain.

## Priority policy

The existing field and options are authoritative and must not be recreated:

- `P0`: Critical; blocks project progress.
- `P1`: High; important near-term work.
- `P2`: Normal.
- `P3`: Low; later improvement / optional work.

## Iteration policy

`Iteration` is **not part of the current Project #2 operating model**.

- Do not create an Iteration field during M4 apply.
- Do not require `--sprint-days` or `--sprint-start` for the no-sprint mode.
- Existing Iteration data, if one appears later, must never be deleted automatically.
- Sprint support may remain an optional future capability, but it is not the default.

## Current inspection (2026-09-05)

| Component | Result |
| --- | --- |
| Project identity | Confirmed |
| Status | Compatible: Backlog, Todo, In Progress, In Review, Done |
| Priority | Compatible and preserved: P0, P1, P2, P3 |
| Iteration | Missing; intentionally not required |
| REST field IDs | Readable |
| Views | Readable; existing Table, Kanban, and Roadmap views detected |
| Workflow details | Current fine-grained PAT cannot read workflow nodes |

View planning requires readable views and REST field IDs, which the current token
provides. Workflow detail inspection is independent and reports its permission
limitation without hiding readable view state.

## Supported automation boundary

| Need | Mechanism | Repository behavior |
| --- | --- | --- |
| Create missing views | GitHub REST API | Existing compatible views are preserved; conflicts require review |
| Issue closed -> Done | GitHub Project built-in workflow | Verify in Project UI |
| PR merged -> Done | GitHub Project built-in workflow | Verify in Project UI |
| Auto-add Issues/PRs | GitHub Project built-in workflow | Configure in Project UI |
| PR ready for review -> In Review | Repository GitHub Actions | Install separately in each source repository |

GitHub exposes view creation through its supported API, but built-in workflow rule
configuration still needs Project UI verification. Repository Actions are kept out
of this repository because the event occurs in the frontend, backend, and LLM/RAG
repositories.

## Commands and safety gates

Read-only inspection:

```bash
pnpm project:foundation:inspect
```

Dry-run remains the default for configuration:

```bash
pnpm project:foundation:configure
```

The M4 configure command uses the no-sprint model by default. It creates or verifies
views without creating Iteration and requires no sprint parameters.

An eventual apply still requires the existing write controls:

```dotenv
GITHUB_PROJECTS_ALLOWED_OWNERS=gyuniverse-hq
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=PVT_kwDOEzfCi84BidwG
GITHUB_PROJECTS_WRITE_ENABLED=true
```

After apply, restore `GITHUB_PROJECTS_WRITE_ENABLED=false` and reduce the credential
to read-only if no more setup changes are planned.

## Desired views

| View | Layout | Filter/grouping | Visible fields |
| --- | --- | --- | --- |
| 📥 Backlog | Table | Status = Backlog | Title, Priority, Repository, Assignees |
| 🏃 Active Work | Board | `status:Todo,"In Progress","In Review"`; columns by Status | Title, Priority, Repository, Assignees, Status |
| 👤 My Work | Table | `assignee:@me -status:Done` | Title, Status, Priority, Repository, Assignees |
| 🔍 Review Queue | Table | Status = In Review | Title, Repository, Linked pull requests, Reviewers, Assignees, Priority |
| 🧩 Workstream | Table | Group by Repository | Title, Repository, Status, Priority, Assignees |

## Apply guarantees

- Confirms the exact Project ID, number, and title before mutation.
- Requires owner and Project allowlists plus the global write gate.
- Rejects incompatible Status or Priority definitions.
- Never recreates or edits Priority.
- Does not create Iteration in the default no-sprint mode.
- Never replaces an existing view.
- Re-reads created views before reporting success.
- Performs no deletion, archival, bulk item mutation, or secret output.

## Remaining work

1. Create/verify the no-sprint views.
2. Verify built-in workflows and auto-add filters in the Project UI.
3. Install the ready-for-review Action in each source repository.
