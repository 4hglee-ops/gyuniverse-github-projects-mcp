# Architecture

## Goal

`gyuniverse-github-projects-mcp` is a focused MCP server for GitHub Projects v2. It intentionally does not reimplement the whole GitHub API. Repository code, Issues, Pull Requests, Actions, and review workflows can continue to use existing GitHub tooling; this server owns the Projects-specific team-state layer.

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
          +--------------------+
          |                    |
          v                    v
 read-only tools          gated write tools
          |                    |
          +---------+----------+
                    v
          src/github/projects.ts
                    |
                    v
          GitHub GraphQL API
                    |
                    v
             GitHub Projects v2
```

## Design principles

1. **Projects-focused**: Avoid duplicating general GitHub repository tooling.
2. **Read-first**: Read operations are the default operating mode.
3. **Explicit writes**: Mutations require `GITHUB_PROJECTS_WRITE_ENABLED=true`.
4. **Allowlist boundaries**: Owners and optionally Project node IDs can be restricted.
5. **No delete tools in v0.1**: destructive project-item deletion is intentionally absent.
6. **Evidence-preserving normalization**: snapshots retain repository, issue/PR number, URL, assignee, project fields, and item IDs.
7. **Workflow state is not completion proof**: AI brief contracts must not treat assignment, intention, or an open PR as completed implementation.

## Initial tool surface

### Read

- `list_github_projects`
- `get_github_project`
- `list_github_project_fields`
- `list_github_project_items`
- `get_github_project_snapshot`
- `get_github_project_brief_context`

### Write (disabled by default)

- `add_github_project_item`
- `update_github_project_item_field`

## Planned evolution

Possible later layers:

- Issue/PR URL -> node ID resolution
- Project delta/checkpoint comparison
- PR merge vs Project status reconciliation
- unassigned/missing-status/state-gap detection
- Discord Evidence vs GitHub Projects cross-checking
- Remote HTTP MCP + OAuth for ChatGPT/Claude
- audit logs for write operations
