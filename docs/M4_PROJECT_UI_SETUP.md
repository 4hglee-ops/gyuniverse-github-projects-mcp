# M4 GitHub Project UI Setup

Use this checklist only for settings that GitHub does not expose safely through the
supported APIs or when the inspection reports an incompatible existing view.

Project #2 uses a **no-sprint continuous-flow model**. Do not create or require an
Iteration field for the initial operating setup.

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
   - Filter: Status is Todo, In Progress, or In Review
   - Columns/grouping: Status
   - Visible fields: Title, Priority, Repository, Assignees, Status
   - Purpose: run active work continuously without a Sprint boundary
3. **👤 My Work**
   - Layout: Table
   - Filter: `assignee:@me`
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
   - Grouping: Repository
   - Visible fields: Title, Repository, Status, Priority, Assignees
   - Purpose: separate frontend, backend, and LLM/RAG workstreams

Save each change, reopen the view, and compare it with the inspection plan. Do not
delete or replace unrelated existing views.

## 2. Built-in status workflows

Open `https://github.com/orgs/gyuniverse-hq/projects/2`, then open the Project menu
and **Workflows**.

Enable and verify:

1. **Item closed**: set `Status` to `Done`.
2. **Pull request merged**: set `Status` to `Done`.

Do not add a second equivalent rule if one is already enabled.

## 3. Auto-add source work

Configure auto-add filters for these repositories:

- `gyuniverse-hq/bid-change-validator-frontend`
- `gyuniverse-hq/bid-change-validator-backend`
- `gyuniverse-hq/bid-change-validator-llm-rag`

Each filter should include both Issues and Pull Requests unless the team deliberately
chooses a narrower scope. Preview matching items before saving. GitHub plan limits
the number of auto-add workflows, so confirm the organization plan before creating
three rules. If the plan limit is lower, use repository Actions as the fallback.

## 4. Ready-for-review transition

The `pull_request.ready_for_review` event belongs in each source repository. Store a
fine-grained token or GitHub App credential as an organization/repository Actions
secret named `PROJECT_AUTOMATION_TOKEN`; never place it in YAML or source control.
Grant only the repository read and organization Projects write permissions needed.

The workflow should:

1. Trigger only on `pull_request: types: [ready_for_review]`.
2. Resolve Project #2 and the PR's existing Project item.
3. Resolve the exact `Status` field and `In Review` option.
4. Skip when the item is absent or already `In Review`.
5. Update that one field.
6. Re-read and verify the resulting value.

Reuse this repository's guarded single-select workflow semantics when extracting the
shared implementation in M5. Until that shared path exists, do not copy a token into
ad-hoc shell commands.

## 5. Verification

After configuration, verify with one non-critical test PR:

- Opening it causes auto-add.
- Marking it ready for review results in `In Review`.
- Merging it results in `Done`.
- Closing a test Issue results in `Done`.
- Priority remains unchanged throughout.
- No Iteration field is required for the workflow.

Record the repository, item URL, before/after Status, and verification time. Then
disable any temporary write credential or test-only workflow.
