# M4 Project Operating Foundation

## Scope

M4 establishes the operating surface for `gyuniverse-hq` Project #2, `LOV WBS`
(`PVT_kwDOEzfCi84BidwG`). It preserves the existing Priority field and adds only
missing, explicitly approved structure.

## Priority policy

The existing field and options are authoritative and must not be recreated:

- `P0`: Critical; blocks project progress.
- `P1`: High; current sprint core.
- `P2`: Normal.
- `P3`: Low; later improvement.

## Iteration policy

Use one `Iteration` field for the team cadence. The duration and first start date
are team decisions and must be passed explicitly at apply time. Existing iterations
are preserved. The Current Sprint view uses `iteration:@current`, so it follows the
active iteration without a periodically edited date filter.

## Current inspection (2026-09-05)

| Component | Result |
| --- | --- |
| Project identity | Confirmed |
| Status | Compatible: Backlog, Todo, In Progress, In Review, Done |
| Priority | Compatible and preserved: P0, P1, P2, P3 |
| Iteration | Missing |
| REST field IDs | Readable |
| Views/workflows | Current fine-grained PAT cannot read these GraphQL resources |

The current permission limitation is fail-closed: the configure command will not
create views until it can read both the existing views/workflows and the REST field
IDs. This prevents duplicate or conflicting same-name views.

## Supported automation boundary

| Need | Mechanism | Repository behavior |
| --- | --- | --- |
| Create Iteration field | GitHub GraphQL API | Requires explicit duration and start date |
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

Dry-run is the default even for the configure command:

```bash
pnpm project:foundation:configure
```

An apply requires all existing write controls plus explicit CLI intent:

```dotenv
GITHUB_PROJECTS_ALLOWED_OWNERS=gyuniverse-hq
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=PVT_kwDOEzfCi84BidwG
GITHUB_PROJECTS_WRITE_ENABLED=true
```

If Iteration is missing, both cadence inputs are mandatory. Choose them as a team;
the tool never silently selects seven or fourteen days.

```bash
pnpm project:foundation:configure -- --apply --sprint-days=14 --sprint-start=2026-09-07
```

Before applying, use a GitHub credential with organization Projects write access and
enough access to read Project views/workflows. After applying, restore
`GITHUB_PROJECTS_WRITE_ENABLED=false` and reduce the credential to read-only if no
more setup changes are planned.

## Desired views

| View | Layout | Filter/grouping | Visible fields |
| --- | --- | --- | --- |
| 📥 Backlog | Table | `status:Backlog` | Title, Priority, Repository, Assignees |
| 🏃 Current Sprint | Board | `iteration:@current`; columns by Status | Title, Priority, Repository, Assignees, Status, Iteration |
| 👤 My Work | Table | `assignee:@me` | Title, Status, Priority, Repository, Iteration, Assignees |
| 🔍 Review Queue | Table | `status:"In Review"` | Title, Repository, Linked pull requests, Reviewers, Assignees, Priority |
| 🧩 Workstream | Table | Group by Repository | Title, Repository, Status, Priority, Assignees, Iteration |

## Apply guarantees

- Confirms the exact Project ID, number, and title before mutation.
- Requires owner and Project allowlists plus the global write gate.
- Rejects incompatible Status or Priority definitions.
- Never recreates or edits Priority.
- Requires explicit Iteration cadence only when Iteration is absent.
- Never replaces an existing view.
- Re-reads Iteration and created views before reporting success.
- Performs no deletion, archival, bulk item mutation, or secret output.

## Remaining decisions

1. Select the sprint duration and first start date.
2. Provide a Project-write credential that can also read views/workflows.
3. Verify built-in workflows and auto-add filters in the Project UI.
4. Install the ready-for-review Action in each source repository.
