# M4 Project Operating Foundation

## Scope

M4 establishes the operating surface for `gyuniverse-hq` Project #2,
`Bid Change Validator · WBS` (`PVT_kwDOEzfCi84BidwG`). The Project name was changed
from the provisional `LOV WBS` label to make the product scope explicit. The Project
node ID and number remain authoritative.

## Repository strategy

The Project must survive the repository transition without changing its role as the
single work-management layer.

### Phase 1 — weekend parallel development

Use the three temporary parallel repositories to reduce merge conflicts while each
workstream moves quickly:

- `gyuniverse-hq/bid-change-validator-frontend`
- `gyuniverse-hq/bid-change-validator-backend`
- `gyuniverse-hq/bid-change-validator-llm-rag`

During this phase, `🧩 Workstream` can group by Repository and clearly separate the
three workstreams.

### Phase 2 — integrated main product

When the integrated product baseline is ready, `gyuniverse-hq/bid-change-validator`
becomes the canonical repository. Normal work then follows the repository branching
model:

```text
main
└── develop
    ├── feature/frontend-*
    ├── feature/backend-*
    ├── feature/llm-rag-*
    └── feature/infra-*
```

`Bid Change Validator · WBS` remains the same Project across both phases. Repository
splitting is a temporary delivery tactic, not a second project-management system.
After consolidation, Workstream grouping may move from Repository to an `area:*` or
component label if repository grouping no longer provides useful separation.

## Operating model

The team uses **GitHub Projects as the primary development work-management system**
and does **not use Sprint / Iteration** for the initial operating model.

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

## Validated automation state (2026-09-05)

The canonical `gyuniverse-hq/bid-change-validator` repository has been used as the
reference implementation and validation target for the long-term automation pattern.

| Flow | Result |
| --- | --- |
| PR auto-add -> Backlog | Validated |
| PR close / merge -> Done | Validated |
| Draft -> Ready for review -> In Review | Validated |
| Priority preservation during transitions | Validated |
| Iteration required | No |

The three temporary parallel repositories may reuse the same pattern during Phase 1
when needed, but the long-term reference implementation belongs to the canonical
`bid-change-validator` repository.

## Supported automation boundary

| Need | Mechanism | Repository behavior |
| --- | --- | --- |
| Create missing views | GitHub REST API | Existing compatible views are preserved; conflicts require review |
| Issue closed -> Done | GitHub Project built-in workflow | Validated against canonical repo flow |
| PR merged -> Done | GitHub Project built-in workflow | Validated against canonical repo flow |
| Auto-add Issues/PRs | GitHub Project built-in workflow | Canonical repo validated; temporary repos may opt in during Phase 1 |
| PR ready for review -> In Review | Repository GitHub Actions | Canonical repo validated; replicate only where needed |

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

An apply still requires the existing write controls:

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
| 🧩 Workstream | Table | Phase 1: Repository; Phase 2: evaluate area/component grouping | Title, Repository, Status, Priority, Assignees |

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

1. Rename Project #2 in GitHub UI to `Bid Change Validator · WBS`.
2. Synchronize `TARGET_PROJECT.title` in code before the next guarded apply.
3. Align remaining documentation and workflow display text with the new name.
4. Restore PAT / Project permissions to the minimum read-only posture after M4 write validation.
