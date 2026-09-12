# Contributing

Thanks for your interest in improving Gyuniverse GitHub Projects MCP.

## Development setup

Requirements:

- Node.js 22+
- pnpm 10.x

```bash
git clone https://github.com/4hglee-ops/gyuniverse-github-projects-mcp.git
cd gyuniverse-github-projects-mcp
pnpm install
cp .env.example .env
```

For local read-only development, start with the smallest possible credential scope and keep all write gates disabled.

```dotenv
GITHUB_PROJECTS_WRITE_ENABLED=false
MCP_OAUTH_WRITE_ENABLED=false
```

Run the standard validation suite before opening a pull request:

```bash
pnpm typecheck
pnpm build
pnpm test
```

## Contribution flow

1. Create a branch from `main`.
2. Keep each pull request focused on one logical change.
3. Add or update tests when behavior changes.
4. Update documentation when configuration, permissions, tools, or runtime behavior changes.
5. Open a pull request with the motivation, impact area, and validation evidence.

## Security-sensitive changes

Changes involving OAuth, credentials, authorization, write operations, audit data, Project allowlists, relationship writes, or bulk operations require extra care.

Please preserve these project invariants:

- GitHub credentials remain server-side.
- Tool discovery is never treated as authorization.
- Writes require explicit runtime authorization.
- Production writes remain bounded by owner and Project allowlists.
- Mutations are verified by re-reading GitHub state when supported.
- Destructive delete operations are not introduced casually.
- Secrets, tokens, access codes, cookies, Authorization headers, or real `.env` values must never be committed, logged, placed in screenshots, or copied into issues/PRs.

If you believe you found a security vulnerability, do not open a public issue containing exploit details or credentials. Use GitHub's private vulnerability reporting feature when available, or contact the maintainer privately.

## Pull request expectations

A good PR description should include:

- what changed
- why it changed
- affected components
- compatibility or security implications
- tests or smoke checks performed
- documentation changes, when applicable

Small documentation fixes are welcome and do not need extensive ceremony.
