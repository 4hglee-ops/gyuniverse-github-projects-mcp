# gyuniverse-github-projects-mcp

Focused MCP server for safe GitHub Projects v2 team workflows.

This repository is intentionally narrower than a general GitHub MCP server. It focuses on Projects metadata, fields, items, normalized team-state snapshots, workflow reconciliation, checkpoint/delta analysis, guarded workflow mutations, and write auditing.

## Status

**v0.2 / M2 implementation complete on Draft PR**

- M1 local Projects MCP complete
- Issue / Pull Request URL and Project-item resolution
- Missing Status / assignee state-gap analysis
- Pull Request merge ↔ Project Status reconciliation
- Process-local Project state checkpoint / delta comparison
- High-level guarded Status / Priority mutation tools
- Process-local bounded write audit log
- Owner / Project allowlists
- Write tools disabled by default
- No delete tools
- stdio transport first

## MCP tools

### GitHub read / analysis

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
| `compare_github_project_state_checkpoint` | Compare current Project state with the latest process-local checkpoint |
| `get_github_project_brief_context` | Return snapshot + team-brief interpretation contract |
| `list_github_project_write_audit_log` | Read recent bounded process-local write audit metadata |

### Local checkpoint state

| Tool | Purpose |
| --- | --- |
| `create_github_project_state_checkpoint` | Capture the current allowed Project snapshot as the process-local comparison baseline |

Creating a checkpoint **does not write to GitHub**. It updates only MCP process memory, replacing the previous checkpoint for the same owner + Project number. The checkpoint does not survive an MCP server restart.

A comparison can report Status, Priority, assignee, repository state, merge state, archive state, custom field, metadata, and snapshot-membership changes. Comparison does not silently replace the baseline; create a new checkpoint explicitly when the current state should become the new baseline.

Current normalized snapshots request at most 100 items. When a snapshot reaches that requested limit, entered/left membership changes are treated as snapshot-window observations rather than authoritative proof of Project add/remove events.

### GitHub write — disabled by default

Preferred high-level workflow tools:

| Tool | Purpose |
| --- | --- |
| `update_github_project_item_status` | Set one Project item's exact Status option by name with Project-membership and post-write verification |
| `update_github_project_item_priority` | Set one Project item's exact Priority option by name with Project-membership and post-write verification |

Lower-level compatibility tools:

| Tool | Purpose |
| --- | --- |
| `add_github_project_item` | Add an existing Issue/PR node to a Project |
| `update_github_project_item_field` | Update text/number/date/single-select/multi-select/iteration fields by node IDs |

There are intentionally **no delete tools**.

The high-level Status/Priority tools should be preferred for AI workflows because they do not require the model to provide raw field and option IDs. They:

1. resolve the allowed Project from owner + Project number
2. require the existing write gate and explicit Project allowlist
3. resolve the exact `Status`/`Priority` single-select field and exact option name
4. query `ProjectV2Item.project` and reject a mismatched item before mutation
5. skip the mutation if the requested value is already set
6. perform one field mutation when needed
7. re-read the item and field after mutation
8. fail if the post-write value does not match
9. append a structured write-audit record

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

After configuring a read-only token in `.env`:

```bash
pnpm smoke:read -- gyuniverse-hq
pnpm smoke:read -- gyuniverse-hq 2
```

The Project-specific command reads metadata, fields, items, and a normalized snapshot. It never invokes a mutation regardless of the write setting.

The read path was integration-tested against `gyuniverse-hq` Project #2 on 2026-09-05 with a fine-grained read-only token.

## Checkpoint / delta workflow

Create a baseline:

```text
Create a state checkpoint for Project #2 under gyuniverse-hq.
```

Later:

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

Checkpoint storage is intentionally process-local. Persistent storage is a separate architecture decision.

## Guarded write workflow

Write operations require all of the following:

1. the token has the minimum required Projects write permission
2. the target Project node ID is explicitly present in `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`
3. `GITHUB_PROJECTS_WRITE_ENABLED=true`

Example high-level request:

```text
Set Project #2 item PVTI_... Status to Done.
```

The Status/Priority path performs Project membership validation and a post-mutation read-back verification before reporting success.

### Low-level single-select smoke test

The existing manual smoke script remains available for a deliberately selected non-critical item:

```bash
pnpm smoke:update-single-select -- <project-id> <item-id> <field-id> <option-id>
```

Use the minimum mutation count necessary to prove behavior, then restore `GITHUB_PROJECTS_WRITE_ENABLED=false` and reduce the token back to read-only when no further write verification is planned.

The M1 write path was integration-tested against a non-critical item in `gyuniverse-hq` Project #2 on 2026-09-05. The new M2 high-level Status/Priority path is covered by secret-free contract/unit tests and CI; a new real mutation is not performed automatically merely because the earlier smoke test succeeded.

## Write audit log

`list_github_project_write_audit_log` exposes the newest process-local write records.

Current properties:

- bounded to the most recent 200 entries
- newest-first reads, maximum 200 entries
- optional Project/item filtering
- records operation, target, outcome and verification state
- high-level Status/Priority writes record requested/before/after option names
- lower-level writes are recorded without arbitrary raw field payloads
- tokens, Authorization headers and raw secret values are never stored
- error records use compact error codes instead of full error response bodies
- process-local only; entries disappear on restart

This is an operational audit aid, not durable compliance logging.

## Safety model

### Owner allowlist

`GITHUB_PROJECTS_ALLOWED_OWNERS` limits users/organizations whose Projects the MCP can read.

### Project allowlist

`GITHUB_PROJECTS_ALLOWED_PROJECT_IDS` is optional for reads. For writes it is mandatory and fail-closed.

### Write gate

```dotenv
GITHUB_PROJECTS_WRITE_ENABLED=false
```

GitHub mutation tools fail closed unless deliberately changed to `true`.

A GitHub write therefore requires both the explicit write gate and an explicit Project allowlist match.

Checkpoint tools and write-audit reads do not bypass or activate GitHub writes.

## CI validation

Pull requests and pushes to `main` run:

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

CI remains secret-free; write smoke tests do not run automatically.

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
│   ├── single-select-update.ts
│   ├── state-gaps.ts
│   └── write-audit.ts
└── mcp/
    ├── build-server.ts
    ├── checkpoint-tools.ts
    ├── workflow-write-tools.ts
    └── stdio.ts
```

## Roadmap

### M1 — local Projects MCP ✅

- [x] GraphQL client
- [x] Project metadata / fields / items
- [x] normalized project snapshot and team brief context
- [x] gated add-item / field-update mutations
- [x] regression tests, build/start scripts and CI
- [x] real read integration test
- [x] gated write integration test against a non-critical item

### M1.1 — scale backlog

- [ ] pagination beyond first 100 normalized snapshot items

This should be implemented before treating snapshot-wide membership analysis as exhaustive for Projects that can exceed the first 100 returned items.

### M2 — workflow intelligence ✅ implementation complete

- [x] Issue / PR URL → node ID resolver
- [x] Issue / PR URL → Project item resolver with cursor pagination
- [x] missing assignee / missing status detection
- [x] PR merge ↔ Project status reconciliation
- [x] project state checkpoint / delta
- [x] safer high-level Status / Priority mutation tools
- [x] bounded process-local write audit log

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

Checkpoint data and write audit records remain process-local in M2. Introducing persistent storage, OAuth, GitHub App migration, remote deployment, Jira, Discord, or Notion integration is a separate architecture/integration boundary.

## License

No license is currently granted. This repository is private during the initial development phase.
