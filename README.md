# gyuniverse-github-projects-mcp

Focused MCP server for GitHub Projects v2 team workflows.

This repository is intentionally narrower than a general GitHub MCP server. It focuses on Projects metadata, fields, items, normalized team-state snapshots, and carefully gated project mutations.

## Status

**v0.1 / M1 complete**

- Read-first GitHub Projects MCP
- Owner / Project allowlists
- Write tools disabled by default
- No delete tools
- stdio transport first
- Real Project read/write integration validated
- Remote HTTP + OAuth planned next

## Initial MCP tools

### Read-only

| Tool | Purpose |
| --- | --- |
| `list_github_projects` | List Projects for an allowed user or organization |
| `get_github_project` | Read one Project by owner + project number |
| `list_github_project_fields` | Read Status, Priority, Iteration and other fields/options |
| `list_github_project_items` | Read issues, PRs, draft items and field values |
| `get_github_project_snapshot` | Normalize project state for AI analysis |
| `get_github_project_brief_context` | Return snapshot + team-brief interpretation contract |

### Write — disabled by default

| Tool | Purpose |
| --- | --- |
| `add_github_project_item` | Add an existing Issue/PR node to a Project |
| `update_github_project_item_field` | Update text/number/date/single-select/multi-select/iteration fields |

There are intentionally **no delete tools in v0.1**.

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

- `read` for the read-only tools
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

### Write gate

```dotenv
GITHUB_PROJECTS_WRITE_ENABLED=false
```

Mutation tools fail closed unless this is explicitly changed to `true`.

A write therefore requires **both**:

1. `GITHUB_PROJECTS_WRITE_ENABLED=true`
2. the target Project node ID in `GITHUB_PROJECTS_ALLOWED_PROJECT_IDS`

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
│   └── projects.ts
└── mcp/
    ├── build-server.ts
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

- [ ] pagination beyond first 100 items

This is not a v0.1 release blocker for the current Gyuniverse Project size; it should be implemented before relying on the server for Projects that can exceed the first 100 returned items.

### M2 — workflow intelligence

- [ ] Issue / PR URL → node ID resolver
- [ ] missing assignee / missing status detection
- [ ] PR merge ↔ Project status reconciliation
- [ ] project state checkpoint / delta
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

## License

No license is currently granted. This repository is private during the initial development phase.
