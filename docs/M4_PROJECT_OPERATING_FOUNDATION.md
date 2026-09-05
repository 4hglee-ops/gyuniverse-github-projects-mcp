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

An apply requires the existing write controls:

```dotenv
GITHUB_PROJECTS_ALLOWED_OWNERS=gyuniverse-hq
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=PVT_kwDOEzfCi84BidwG
GITHUB_PROJECTS_WRITE_ENABLED=true
```

These gates are part of the operator security boundary and are not a replacement for
per-user authorization.

## Write-capable operator posture after M4

The MCP is intended to become a **multi-user AI Project Operator**, not a permanently
read-only Project viewer. The server-side GitHub credential may therefore retain the
minimum Organization Projects **write** permission needed by the supported operator
mutations.

A write-capable server credential does **not** mean every connected user is entitled
to write. The long-term access decision belongs to the application identity and
permission layers:

```text
Authentication
  -> User Identity
  -> Project Membership
  -> Role / Permission
  -> Operation Policy
  -> Write Guard
  -> GitHub mutation
```

Target roles include:

- **Admin / PM** — broad Project read/write within policy.
- **Member** — selected writes such as status, priority, or self-assignment according to policy.
- **Viewer** — read-only.

Multiple users may therefore become authorized write users. Write access is not tied
to one named operator or to the MCP server credential itself.

### Current pre-Identity/ACL stage

Individual Identity / ACL is not complete in M4. Until that layer is implemented,
write-capable MCP use is a **controlled development/operator mode** for a limited set
of trusted users rather than the final multi-user authorization model.

Keep the existing defense-in-depth controls active:

- OAuth `projects:read` / `projects:write` scope separation.
- explicit owner and Project node-ID allowlists.
- `GITHUB_PROJECTS_WRITE_ENABLED` write gate.
- operation-specific validation and membership checks.
- post-mutation re-read verification.
- structured write audit metadata.
- destructive operations excluded from the initial operator surface.

Before write access is opened broadly to the team or external users, Individual
Identity + ACL must become the authoritative permission layer.

### Repository automation credential

The canonical repository workflow uses the separate Actions secret
`PROJECT_AUTOMATION_TOKEN` for `ready_for_review -> In Review`. That workflow performs
a ProjectV2 Status mutation, so this credential also needs the minimum Projects
**write** permission while the workflow is enabled.

Keep this automation credential separate from the MCP credential. Its repository
access should be limited to what the workflow needs, and a dedicated GitHub App can
replace the PAT later without changing the workflow contract.

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

## M4 closeout

Completed:

- Project renamed to `Bid Change Validator · WBS`.
- `TARGET_PROJECT.title` synchronized with the live Project.
- Workflow display text aligned with the new name.
- No-sprint views and native automation validated.
- `ready_for_review -> In Review` validated with a temporary Draft PR.
- write-capable MCP operator direction retained for controlled development.
- future multi-user write access explicitly assigned to the Identity / ACL roadmap rather than one operator.

M4 does not claim that final per-user authorization is complete. That remains a later
Identity Foundation milestone before broad multi-user write rollout.
