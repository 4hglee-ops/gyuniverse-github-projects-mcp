# Architecture

## Goal

`gyuniverse-github-projects-mcp` is a focused MCP server for GitHub Projects v2. It intentionally does not reimplement the whole GitHub API. Repository code, Issues, Pull Requests, Actions, and review workflows can continue to use existing GitHub tooling; this server owns the Projects-specific team-state and workflow layer.

## Layers

```text
ChatGPT / Claude / Codex
          |
          v
        MCP
          |
          v
src/mcp/build-server.ts
          |
          +---------------------------+
          |                           |
          v                           v
 read / analysis tools       gated workflow write tools
          |                           |
          |                 Status / Priority by name
          |                           |
          |                    membership check
          |                           |
          |                    mutation + re-read
          |                           |
          +-------------+-------------+
                        v
              src/github/projects.ts
                        |
                        v
              GitHub GraphQL API
                        |
                        v
                 GitHub Projects v2
```

Process-local workflow helpers sit beside the GitHub adapter:

```text
src/workflow/
├── checkpoint.ts            # normalized checkpoint + delta comparison
├── reconciliation.ts        # PR merge ↔ Project Status analysis
├── state-gaps.ts            # missing Status / assignee analysis
├── single-select-update.ts  # guarded named Status/Priority update core
└── write-audit.ts           # bounded process-local mutation audit metadata
```

## Design principles

1. **Projects-focused**: Avoid duplicating general GitHub repository tooling.
2. **Read-first**: Read operations are the default operating mode.
3. **Explicit writes**: Mutations require `GITHUB_PROJECTS_WRITE_ENABLED=true`.
4. **Allowlist boundaries**: Owners and optionally Project node IDs can be restricted; an explicit Project allowlist is mandatory for writes.
5. **No delete tools**: destructive Project/Project-item deletion is intentionally absent.
6. **Evidence-preserving normalization**: snapshots retain repository, issue/PR number, URL, assignee, project fields, and item IDs.
7. **Workflow state is not completion proof**: AI brief contracts must not treat assignment, intention, or an open PR as completed implementation.
8. **High-level workflow writes are preferred**: Status/Priority tools resolve exact field/option names internally instead of asking the model to supply raw field/option node IDs.
9. **Verify writes**: high-level Status/Priority writes validate item→Project membership before mutation and re-read the field after mutation.
10. **No-op before mutation**: if the requested Status/Priority is already set, the high-level path skips the mutation.
11. **Bounded audit metadata**: process-local write audit records operation/target/outcome/verification metadata without storing tokens, Authorization headers, or arbitrary raw mutation payloads.

## Current tool surface

### Read / analysis

- `list_github_projects`
- `get_github_project`
- `list_github_project_fields`
- `list_github_project_items`
- `resolve_github_issue_or_pr_url`
- `resolve_github_project_item`
- `get_github_project_snapshot`
- `analyze_github_project_state_gaps`
- `analyze_github_project_reconciliation`
- `create_github_project_state_checkpoint` (process-local state only; no GitHub mutation)
- `compare_github_project_state_checkpoint`
- `get_github_project_brief_context`
- `list_github_project_write_audit_log`

### Write (disabled by default)

Preferred workflow-level tools:

- `update_github_project_item_status`
- `update_github_project_item_priority`

Lower-level compatibility tools:

- `add_github_project_item`
- `update_github_project_item_field`

The lower-level tools remain gated and allowlisted, but they expose IDs directly and therefore provide fewer semantic safety checks than the workflow-level Status/Priority tools. New AI workflows should prefer the high-level tools when applicable.

## High-level Status/Priority update sequence

```text
owner + Project number + item ID + requested option name
        |
        v
resolve allowed Project
        |
        v
require write gate + explicit Project allowlist
        |
        v
resolve exact single-select field and exact option name
        |
        v
read ProjectV2Item.project and current field value
        |
        +-- Project mismatch --> fail closed
        |
        +-- already requested value --> verified no-op
        |
        v
updateProjectV2ItemFieldValue
        |
        v
re-read Project membership + field value
        |
        +-- mismatch --> MUTATION_VERIFICATION_FAILED
        |
        v
verified success + audit record
```

## Process-local state

Checkpoint baselines and write audit entries are currently held in MCP process memory. They do not introduce a database or cloud dependency and do not survive process restart. Persistent state is a separate architecture decision and is not implied by the current M2 implementation.

The write audit is bounded to the most recent 200 records and exposes at most 200 records per read. It records structured metadata rather than full request/error bodies.

## Remaining boundaries

- normalized snapshot-wide analysis is still bounded by the first 100 returned Project items; the pagination-aware single-item resolver is exhaustive within configured page limits
- real write integration tests require an intentionally write-capable token, explicit Project allowlist, and write gate; CI remains secret-free and does not run write smoke tests
- Draft PR → Ready for review, merge, release, deployment, auth migration, persistent storage, and external integrations remain human-governance or architecture boundaries
