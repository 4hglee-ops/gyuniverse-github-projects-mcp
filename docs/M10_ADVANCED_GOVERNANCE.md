# M10 Advanced Governance

M10 turns the operator's process-local governance state into durable, reviewable operating state and then adds higher-risk orchestration behind explicit safety boundaries.

## Sequence

1. **M10-1 Durable checkpoint** — persist the latest Project comparison baseline across serverless instances/restarts.
2. **M10-2 Durable write audit** — persist bounded actor-aware write records and make later reads reliable across requests.
3. **M10-3 Dependency / sub-issue reads** — expose native relationship evidence without inferred dependencies.
4. **M10-4 Guarded dependency / sub-issue writes** — explicit semantic operations with verification and ACL.
5. **M10-5 Bulk Preview → Approval → Apply** — no direct bulk mutation; preview is immutable input to a separately approved apply step.
6. **M10-6 Richer ACL** — operation- and Project-scoped policy refinement where the existing Admin/Member/Viewer matrix is insufficient.
7. **M10-7 Production validation / milestone close**.

Sprint / Iteration remains optional and is not reintroduced into Project #2 unless the operating model changes explicitly.

## M10-1 Durable checkpoint

The checkpoint boundary now uses a persistence abstraction instead of a process-owned `Map` directly.

### Storage modes

- `memory`: local development / explicit fallback.
- `upstash`: durable latest-checkpoint storage using the existing Upstash REST deployment with an isolated `gyuniverse:m10:checkpoint:v1:*` key namespace.

When `M10_GOVERNANCE_STORE` is omitted, a Production environment already configured with `MCP_OAUTH_REPLAY_STORE=upstash` and shared Upstash credentials automatically uses Upstash for M10 governance state. This avoids introducing a second database only for checkpoints.

### Safety / semantics

- Checkpoint persistence does **not** write to GitHub.
- One latest baseline is stored per `owner + Project number`, preserving the existing comparison contract.
- Stored payloads are validated before use; malformed/mismatched data fails closed with `DURABLE_CHECKPOINT_INVALID`.
- `get_project_changes` still never replaces the baseline implicitly.
- `create_github_project_state_checkpoint` explicitly replaces the latest baseline for that Project.
- Results report whether persistence is `process_local` or `upstash` and whether it survives server restart.

### Validation target

Production validation for M10-1 should prove:

1. create a checkpoint in one request,
2. perform a later request that reaches a fresh serverless instance or after redeploy,
3. compare against the previously stored checkpoint without reinitializing it,
4. confirm `persistence.kind = upstash` and `survivesServerRestart = true`.

No secrets, Redis credentials, OAuth access codes, or bearer tokens belong in validation output.

## Remaining

- [x] M10-1 durable checkpoint store abstraction
- [x] M10-1 Upstash reuse / namespaced storage
- [x] M10-1 cross-instance restore regression tests
- [ ] M10-1 Production cross-request/redeploy validation
- [ ] M10-2 durable write audit
- [ ] M10-3 dependency / sub-issue evidence
- [ ] M10-4 guarded relationship writes
- [ ] M10-5 Bulk Preview → Approval → Apply
- [ ] M10-6 richer ACL
- [ ] M10-7 final validation / close
