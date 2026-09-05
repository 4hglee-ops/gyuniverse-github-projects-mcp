# gyuniverse-github-projects-mcp

Focused MCP server for GitHub Projects v2 team workflows.

This repository is intentionally narrower than a general GitHub MCP server. It focuses on Projects metadata, fields, items, normalized team-state snapshots, workflow reconciliation, checkpoint/delta analysis, and carefully gated project mutations.

## Status

**v0.2 / M2 in progress**

- M1 local Projects MCP complete
- Issue / Pull Request URL and Project-item resolution
- Missing Status / assignee state-gap analysis
- Pull Request merge ↔ Project Status reconciliation
- Process-local Project state checkpoint / delta comparison
- Owner / Project allowlists
- Write tools disabled by default
- No delete tools
- stdio transport first

## MCP tools

### GitHub read-only

| Tool | Purpose |
| --- | --- |
| `list_github_projects` | List Projects for an allowed user or organization |
| `get_github_project` | Read one Project by owner + project number |
| `list_github_project_fields` | Read Status, Priority, Iteration and other fields/options |
| `list_github_project_items` | Read issues, PRs, draft items and field values |
| `resolve_github_issue_or_pr_url` | Resolve a GitHub Issue/PR URL to stable content metadata and node ID |
| `resolve_github_project_item` | Resolve an Issue/PR URL to its matching Project item with cursor pagination |
| `get_github_project_snapshot` | Normalize project state for AI analysis |
| `analyze_github_project_state_gaps` | Detect missing Status and missing assignee state gaps |
| `analyze_github_project_reconciliation` | Detect PR merge ↔ Project Status mismatches |
| `compare_github_project_state_checkpoint` | Compare current Project state with the latest process-local checkpoint without replacing it |
| `get_github_project_brief_context` | Return snapshot + team-brief interpretation contract |

### Local checkpoint state

| Tool | Purpose |
| --- | --- |
| `create_github_project_state_checkpoint` | Capture the current allowed Project snapshot as the process-local comparison baseline |

Creating a checkpoint **does not write to GitHub**. It updates only MCP process memory, replacing the previous checkpoint for the same owner + Project number. The checkpoint does not survive an MCP server restart.

A comparison can report Status, Priority, assignee, repository state, merge state, archive state, custom field, metadata, and snapshot-membership changes. Comparison does not silently replace the baseline; create a new checkpoint explicitly when the current state should become the new baseline.

Current normalized snapshots request at most 100 items. When a snapshot returns exactly the requested limit, the checkpoint marks coverage as potentially incomplete. Attribute changes for matching Project item IDs remain useful, but entered/left snapshot membership is reported as an observation rather than authoritative proof that an item was added to or removed from the Project. This avoids overstating results until snapshot pagination is implemented.

### GitHub write — disabled by default

| Tool | Purpose |
| --- | --- |
| `add_github_project_item` | Add an existing Issue/PR node to a Project |
| `update_github_project_item_field` | Update text/number/date/single-select/multi-select/iteration fields |

There are intentionally **no delete tools**.

## Why a dedicated Projects MCP?

```text
ChatGPT / Claude / Codex
          |
    +-----+-------------------+
    |                         |
Discord Bridge        GitHub Projects MCP
    |                         |
team conversation       project workflow state
    |                         |
    +-----------+-------------+
                |
          Team Context
```

General GitHub tooling can continue to handle repository code, Issues, Pull Requests, reviews, and Actions. This server owns the Projects-specific workflow/state layer.

## Requirements

- Node.js 22+
- pnpm
- GitHub token that can access the target Projects

For organization Projects, use a fine-grained token with the minimum required **Projects** organization permission:

- `read` for GitHub read/analysis/checkpoint workflows
- `write` only when mutation tools are intentionally enabled

Your GitHub organization may require approval for fine-grained personal access tokens.

## Setup

```bash
git clone https://github.com/4hglee-ops/gyuniverse-github-projects-mcp.git
cd gyuniverse-github-projects-mcp
pnpm install
cp .env.example .env
```

Configure `.env`:

```dotenv
GITHUB_TOKEN=github_pat_...
GITHUB_PROJECTS_ALLOWED_OWNERS=4hglee-ops,gyuniverse-hq
GITHUB_PROJECTS_ALLOWED_PROJECT_IDS=
GITHUB_PROJECTS_WRITE_ENABLED=false
```

Then run:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm start
```

Use `pnpm mcp:stdio` during development when you want to run directly from TypeScript.

## Read-only integration smoke test

After configuring a read-only token in `.env`, list the accessible Projects for an allowed owner:

```bash
pnpm smoke:read -- gyuniverse-hq
```

To validate the complete read path for one Project number:

```bash
pnpm smoke:read -- gyuniverse-hq 3
```

The second command reads project metadata, fields, items, and a normalized snapshot. It never invokes a mutation, regardless of the write setting.

The read path was integration-tested against `gyuniverse-hq` Project #2 on 2026-09-05. Project listing, metadata, fields, items, and snapshot normalization all completed successfully with a fine-grained read-only token.

## Checkpoint / delta workflow

With the MCP running, create a baseline:

```text
Create a state checkpoint for Project #2 under gyuniverse-hq.
```

After Project state changes, compare against that same baseline:

```text
Compare Project #2 with its latest checkpoint and show only what changed.
```

Useful delta categories include:

- `status_changed`
- `priority_changed`
- `assignees_changed`
- `repository_state_changed`
- `merged_changed`
- `archived_changed`
- `field_changed`
- `item_metadata_changed`
- `item_entered_snapshot`
- `item_left_snapshot`

Checkpoint storage is intentionally process-local in the current M2 implementation. Persistent checkpoint storage would introduce a new storage/backend concern and is deferred until a later milestone explicitly requires it.

## Gated write integration smoke test

Use the single-select smoke command only for a non-critical item after all three write boundaries are deliberately configured: the token has Projects write permission, the target Project node ID is explicitly allowlisted, and `GITHUB_PROJECTS_WRITE_ENABLED=true`.

```bash
pnpm smoke:update-single-select -- <project-id> <item-id> <field-id> <option-id>
```

The command accepts only a single-select option update and calls the same guarded mutation path used by the MCP server. Restore `GITHUB_PROJECTS_WRITE_ENABLED=false` immediately after the test and reduce the token back to read-only when no further mutation work is planned.

The write path was integration-tested against a non-critical item in `gyuniverse-hq` Project #2 on 2026-09-05. A Status option update succeeded, and a subsequent read-only snapshot independently confirmed the new value.

## Safety model

### Owner allowlist

`GITHUB_PROJECTS_ALLOWED_OWNERS`

Limits the users/organizations whose Projects the MCP can read.

### Project allowlist

`GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`

For **read operations**, this is optional. When empty, all Projects under an allowed owner may be read. When populated, only the listed ProjectV2 node IDs are exposed.

For **write operations**, this is mandatory. Mutation tools fail closed unless at least one explicit ProjectV2 node ID is configured, and the target Project node ID must be present in that allowlist.

Checkpoint creation and comparison use the same read-side owner/Project validation before capturing current state.

### Write gate

```dotenv
GITHUB_PROJECTS_WRITE_ENABLED=false
```

GitHub mutation tools fail closed unless this is explicitly changed to `true`.

A GitHub write therefore requires **both**:

1. `GITHUB_PROJECTS_WRITE_ENABLED=true`
2. the target Project node ID in `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`

The checkpoint tools do not use or bypass the GitHub write gate because they never mutate GitHub state.

## CI validation

Pull requests and pushes to `main` run:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

CI installs pnpm before enabling the `setup-node` pnpm cache so the cache resolver can find the executable.

## Example prompts

Once connected to an MCP client:

```text
List the GitHub Projects available under gyuniverse-hq.
```

```text
Show Project #3's fields and explain the Status / Priority / Iteration options.
```

```text
Create a current-state brief for Project #3. Separate In Progress, Assigned Work,
Unassigned Work, Done, and State Gaps. Do not treat an open PR as completed work.
```

```text
Create a checkpoint for Project #2, then later compare the current state with that checkpoint.
```

Later, with write mode deliberately enabled:

```text
Move this project item to the selected Status option.
```

## Current architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```text
src/
├── config.ts
├── github/
│   ├── graphql-client.ts
│   ├── project-items.ts
│   ├── projects.ts
│   └── references.ts
├── workflow/
│   ├── checkpoint.ts
│   ├── reconciliation.ts
│   └── state-gaps.ts
└── mcp/
    ├── build-server.ts
    ├── checkpoint-tools.ts
    └── stdio.ts
```

## Roadmap

### M1 — local Projects MCP ✅

- [x] GraphQL client
- [x] Project metadata
- [x] Project fields/options
- [x] Project items
- [x] multi-select field support
- [x] normalized project snapshot
- [x] team brief context contract
- [x] gated add-item mutation
- [x] gated field update mutation
- [x] regression tests
- [x] reproducible lockfile
- [x] build/start scripts
- [x] CI validation pipeline
- [x] local integration test against a real Project
- [x] gated write integration test against a non-critical item

### M1.1 — scale backlog

- [ ] pagination beyond first 100 normalized snapshot items

This is not a v0.1 release blocker for the current Gyuniverse Project size; it should be implemented before treating snapshot-wide membership analysis as exhaustive for Projects that can exceed the first 100 returned items.

### M2 — workflow intelligence

- [x] Issue / PR URL → node ID resolver
- [x] Issue / PR URL → Project item resolver with cursor pagination
- [x] missing assignee / missing status detection
- [x] PR merge ↔ Project status reconciliation
- [x] project state checkpoint / delta
- [ ] safer high-level Status / Priority mutation tools
- [ ] write audit log

### M3 — remote MCP

- [ ] HTTP transport
- [ ] OAuth / protected resource metadata
- [ ] ChatGPT connection
- [ ] Claude connection
- [ ] deployment

### M4 — Gyuniverse cross-context

- [ ] Discord Evidence ↔ GitHub Projects reconciliation
- [ ] Decision / Work / Blocker cross-checking
- [ ] unified Team Brief

## Security

Never commit GitHub tokens or `.env` files. Keep write permissions disabled except during a concrete, allowlisted mutation workflow against an intended Project item.

Checkpoint data can contain Project titles, repository names, assignees, field values, and URLs. In the current implementation it remains in the MCP server process only and is not written to a new external storage system.

## License

No license is currently granted. This repository is private during the initial development phase.
