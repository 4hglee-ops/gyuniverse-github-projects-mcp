# M9 — REST / GPT Actions

## Goal
Expose the AI Project Operator through a semantic REST adapter that calls the same Shared Core as MCP.

```text
ChatGPT / GPT Actions
        |
      REST
        |
        +----------------------+
        |      Shared Core     |
        +----------------------+
        |
      GitHub

Claude / ChatGPT MCP
        |
       MCP
        |
        +----------------------+
        |      Shared Core     |
        +----------------------+
```

REST must not call MCP and MCP must not call REST.

## M9 sequence

- [x] M9-1 OAuth-protected semantic REST read adapter
- [x] M9-1 OpenAPI 3.1 document for GPT Actions discovery
- [x] M9-1 Identity-bound `my-work` without caller-supplied impersonation
- [ ] M9-2 Semantic REST write adapter using `HighLevelWriteService`
- [ ] M9-3 OpenAPI write operations and write-scope declarations
- [ ] M9-4 REST error/status normalization and action-oriented examples
- [ ] M9-5 Production OAuth + GPT Actions live validation
- [ ] M9-6 Documentation and M9 completion review

## M9-1 REST read surface

Public discovery:

- `GET /openapi.json`

OAuth-protected:

- `GET /api/v1/identity`
- `POST /api/v1/project/brief`
- `POST /api/v1/project/my-work`
- `POST /api/v1/project/backlog`
- `POST /api/v1/project/review-queue`
- `POST /api/v1/project/unassigned`
- `POST /api/v1/project/blockers`

All Project reads reuse `ProjectService -> SnapshotService -> HighLevelReadService`, so owner allowlists, Project allowlists, authenticated `project.read`, and per-principal Project membership remain authoritative.

`my-work` derives the GitHub login from the authenticated principal. REST callers cannot supply another login and impersonate another operator.

## OAuth

The OpenAPI document reuses the existing authorization-code flow:

- authorization endpoint: `/oauth/authorize`
- token endpoint: `/oauth/token`
- read scope: `projects:read`
- write scope: `projects:write`

M9-1 exposes read operations only. Advertising `projects:write` in the OAuth scheme does not itself create a REST write surface or bypass M7/M8 authorization.

## Response contract

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "bounded human-readable message"
  }
}
```

No access codes, OAuth bearer tokens, backend GitHub credentials, or raw identity registry records are returned.

## Serverless note

Process-local checkpoint/change history is intentionally not exposed by the first REST slice because a new serverless request may use a different process. Durable checkpoints remain M10. REST reads in M9-1 are request-local and evidence-backed.
