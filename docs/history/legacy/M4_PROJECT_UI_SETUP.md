# M4 GitHub Project UI Setup

Use this checklist only for settings that GitHub does not expose safely through the
supported APIs or when inspection reports an incompatible existing view.

Project #2 is named `Bid Change Validator · WBS` and uses a **no-sprint
continuous-flow model**. Do not create or require an Iteration field for the initial
operating setup.

## 1. Views

Run `pnpm project:foundation:inspect` first. Create a view manually only when it is
missing, or repair a same-name view reported as `manual-review`. In Project #2,
select **New view**, choose the listed layout, rename the view, then open the view's
filter/group and field menus.

1. **📥 Backlog**
   - Layout: Table
   - Filter: `status:Backlog`
   - Grouping: None
   - Visible fields: Title, Priority, Repository, Assignees
   - Purpose: triage work that has not started yet
2. **🏃 Active Work**
   - Layout: Board
   - Filter: `status:Todo,"In Progress","In Review"`
   - Columns/grouping: Status
   - Visible fields: Title, Priority, Repository, Assignees, Status
   - Purpose: run active work continuously without a Sprint boundary
3. **👤 My Work**
   - Layout: Table
   - Filter: `assignee:@me -status:Done`
   - Grouping: None
   - Visible fields: Title, Status, Priority, Repository, Assignees
   - Purpose: show work assigned to the current viewer
4. **🔍 Review Queue**
   - Layout: Table
   - Filter: `status:"In Review"`
   - Grouping: None
   - Visible fields: Title, Repository, Linked pull requests, Reviewers, Assignees, Priority
   - Purpose: surface work waiting for review
5. **🧩 Workstream**
   - Layout: Table
   - Filter: None
   - Phase 1 grouping: Repository
   - Phase 2: evaluate `area:*` / component grouping after consolidation into the canonical repo
   - Visible fields: Title, Repository, Status, Priority, Assignees
   - Purpose: preserve workstream visibility across repository transition

Do not delete or replace unrelated existing views.

## 2. Repository lifecycle

### Phase 1 — weekend parallel development

Temporary parallel repositories:

- `gyuniverse-hq/bid-change-validator-frontend`
- `gyuniverse-hq/bid-change-validator-backend`
- `gyuniverse-hq/bid-change-validator-llm-rag`

These repositories exist to let frontend, backend, and LLM/RAG work proceed in
parallel with minimal merge friction. They are not separate long-term product
management surfaces.

### Phase 2 — canonical repository

After the integrated product baseline is established, use:

- `gyuniverse-hq/bid-change-validator`
- base integration branch: `develop`
- normal work: feature branches under `develop`
- stable release flow: `develop -> main`

`Bid Change Validator · WBS` remains the same Project in both phases.

## 3. Built-in status workflows

Open `https://github.com/orgs/gyuniverse-hq/projects/2`, then open the Project menu
and **Workflows**.

Enable and verify:

1. **Item closed**: set `Status` to `Done`.
2. **Pull request merged**: set `Status` to `Done`.

These transitions have already been validated against the canonical
`gyuniverse-hq/bid-change-validator` repository. Do not add a second equivalent rule
if one is already enabled.

## 4. Auto-add source work

The canonical repository is the long-term automation reference:

- `gyuniverse-hq/bid-change-validator`

Validated canonical flow:

```text
new PR / item -> Backlog
Ready for review -> In Review
close / merge -> Done
```

During Phase 1, the three temporary parallel repositories may opt into the same
Project auto-add pattern when needed so all active work remains visible in the same
WBS. Do not document the three temporary repositories as the permanent source of
truth.

## 5. Ready-for-review transition

The canonical implementation lives in:

`gyuniverse-hq/bid-change-validator/.github/workflows/project-ready-for-review.yml`

It uses Project node ID `PVT_kwDOEzfCi84BidwG`, so renaming the Project does not
change the target. Store the credential as `PROJECT_AUTOMATION_TOKEN`; never place
its value in YAML or source control.

The workflow:

1. Triggers only on `pull_request: types: [ready_for_review]`.
2. Resolves Project #2 and the PR's existing Project item.
3. Resolves the exact `Status` field and `In Review` option.
4. Skips when the item is absent or already `In Review`.
5. Updates only that Status field.
6. Re-reads and verifies the resulting value.

This path was validated with a temporary Draft PR on 2026-09-05. The same pattern may
be replicated into a temporary Phase 1 repository only when that repository needs the
transition.

## 6. Verification record

Validated on the canonical repository:

- PR auto-add -> `Backlog`: passed
- Draft -> Ready for review -> `In Review`: passed
- Close / Merge -> `Done`: passed
- Priority remained unchanged: passed
- No Iteration field required: passed

After the Project rename, re-run a read-only inspection to confirm the new title and
stable Project ID before reducing PAT permissions.
