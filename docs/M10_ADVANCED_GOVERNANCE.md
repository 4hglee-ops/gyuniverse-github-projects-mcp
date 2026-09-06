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

## M10-2 Durable write audit

Write audit ownership now uses the same governance persistence selection as checkpoints while keeping an independent schema and Redis namespace.

### Storage / retention

- `memory`: process-local fallback for local development and tests.
- `upstash`: durable newest-first history under the isolated `gyuniverse:m10:audit:v1:*` namespace.
- The retained history is capped at 200 records. Upstash append and trim execute in one Redis Lua operation so the bound is applied atomically.
- Reads support the existing `limit`, `projectId`, and `itemId` filters and report the selected persistence mode plus restart-survival behavior.

### Safety / failure behavior

- Audit records are reconstructed from an allowlist of metadata fields; arbitrary input properties and raw mutation payloads are discarded.
- String metadata is length-bounded. Tokens, OAuth secrets, access codes, PATs, Authorization headers, and full error bodies are not part of the stored schema.
- Durable records use collision-resistant IDs so independent serverless instances do not share a process counter.
- Malformed durable payloads fail closed with `DURABLE_AUDIT_INVALID` instead of returning incomplete or misleading history.
- If an audit append fails, a write does not return a normal success envelope. It reports `AUDIT_PERSISTENCE_FAILED`; clients must re-read target state and must not retry automatically.

Production validation after merge must prove a safe reversible/no-change write creates an audit record, a later request can list it, and the same record remains after a Production redeploy with `persistence = upstash` and `survivesServerRestart = true`.

### Production validation handoff

The operator's “연결 및 CI 점검” handoff reports PR #41 merged and a safe `Todo → Todo` write on Project #2 Issue #4 verified. Audit record `write-ed406b9f-2426-454d-aa6f-8d02a6adb0fb` remained after Production redeploy with `persistence = upstash` and `survivesServerRestart = true`. This is accepted handoff evidence, not a new Production test performed by M10-3. The Project owner is `gyuniverse-hq`; actor login is `4hglee-ops`. Existing write configuration remains unchanged.

## M10-3 Native relationship reads

`get_github_project_item_relationships({ owner, number, itemId, first? })` reads one GitHub Issue Project item's native relationships through Shared Core. `first` defaults to 50 and is limited to 100 **per relationship connection**. No relationship mutation, new permissions, environment changes, or automatic blocker inference is introduced.

The [GitHub GraphQL Issue reference](https://docs.github.com/en/graphql/reference/issues) defines `parent`, `subIssues`, `blocking`, and `blockedBy`. The adapter returns these as `parent`, `subIssues`, `blocks`, and `blockedBy` respectively:

- `parent`: source Issue has target as parent.
- `subIssues`: source Issue has target as a sub-issue.
- `blocks`: source Issue blocks target.
- `blockedBy`: source Issue is blocked by target.

Each group has `targets` and `coverage`, including native `totalCount`, fetched/returned counts, withheld reasons, `hasNextPage`, and `complete`. A parent that exists but cannot be disclosed is **not** represented as absent: its count remains one with an empty target list and incomplete coverage. Targets use existing `itemId`, `contentId`, `contentType`, `repository`, `number`, `title`, `url`, and `state` names.

### Authorization and bounded reads

1. Resolve the Project through existing owner/Project allowlists, `project.read`, and principal Project membership checks before querying Issue content. Actor login never substitutes for Project owner.
2. Scan up to ten 100-item Project pages to establish source and target membership. PR/Draft sources are unsupported; inaccessible source content fails closed. Missing source on an incomplete scan is `PROJECT_ITEM_LOOKUP_INCOMPLETE`, not “not found.”
3. Fetch only related Issue IDs from the native relationship fields. Detailed target metadata comes exclusively from the authorized Project inventory and is returned only for allowed repository owners. OAuth callers share a server GitHub credential; arbitrary repository visibility must not be treated as the caller's authorization.
4. Withhold external target details (including node IDs, repository names, titles and URLs). Report aggregate `outsideProject`, `membershipUnverified`, or `repositoryOwnerNotAllowed` counts. A capped scan or inaccessible Project content prevents an exhaustive outside-Project claim.
5. Fetch the first bounded relationship page only. When `hasNextPage=true`, results are explicitly incomplete; this version has no continuation input. Larger Projects or relationship sets are not claimed exhaustive. Unknown GraphQL fields, permission failures and malformed data fail instead of becoming empty relationship lists.

Relationships may involve closed Issues; presence alone does not prove an active blocker. `get_blockers` and `get_project_brief` continue to use their existing explicit Project-field evidence. Ordinary snapshots/checkpoints are unchanged. Calls span multiple reads and are not a transactional snapshot; concurrent GitHub changes can affect coverage, so re-read before making operational decisions.

### Deployment validation plan (read-only)

- Confirm Preview is Ready and the new MCP tool is advertised with `readOnlyHint=true`.
- Using an authorized principal and `owner=gyuniverse-hq`, Project #2, resolve a known Issue's Project item ID and call the new tool. Empty relationships are valid only with explicit coverage.
- On existing fixtures where available, compare native parent/sub-issue and dependency direction with GitHub; check closed Issue state and withheld external-Project counts. Do not create or modify relationships to manufacture test data without separate approval.
- Verify unauthorized owner/Project and PR/Draft inputs fail, then re-run existing snapshot/brief/blocker reads. Confirm no GitHub writes or audit append were triggered.
- After human merge and Production deployment, repeat the read-only checks before closing M10-3. Stop before merge; M10-4 writes and M10-5 bulk operations remain out of scope.

### Production validation completed

After PR #42 merge, direct authenticated HTTPS calls to `https://gyuniverse-github-projects-mcp.vercel.app/mcp` returned 32 tools including `get_github_project_item_relationships`. A legitimate PKCE read-scope session resolved to `gyuniverse-projects-team`, role `viewer`, `project.read`, `githubLogin=null` (separate from the admin connector session). Issue #4 in `gyuniverse-hq` Project #2 returned empty parent/subIssues/blocks/blockedBy groups, all `complete=true`; all ten Project items were covered without inaccessible items or additional pages. M10-3 is Production-validated. The stale connected tool catalog is not a server registration defect.

## M10-4 Guarded relationship writes

Implementation and local regression coverage are complete for four native single-edge mutations, guarded by a new admin-only `item.relationship.write` permission, same-Project membership, bounded cycle checks, normalized reciprocal re-read verification and durable audit. The operator handoff confirms the reviewed Production validation and cleanup were completed; M10-4 is closed. See [M10 relationship writes](M10_RELATIONSHIP_WRITES.md) for directions, limits and audit compatibility.

## M10-5 Bulk Preview → Approval → Apply

The first bounded slice implements immutable, expiring and durable plans for 1–20
Status/Priority updates in one Project. The creating Admin explicitly approves the
same digest before a full all-item preflight and a CAS-protected single-use Apply.
Preflight failures perform zero writes; runtime failures stop remaining operations
and become terminal `failed`/`partial` results without retry or rollback. Existing
durable item audits receive optional `planId` correlation and the plan stores
separate bounded lifecycle events. See [M10 bulk plans](M10_BULK_PLANS.md).

Production validation is complete: the two-item fixture apply, per-item durable
audit correlation, duplicate Apply no-op, bulk cleanup, stale-plan zero-write
failure and post-redeploy plan/audit restoration were verified. Issues #8 and #9
were restored to Backlog.

## M10-6 Richer ACL

Implementation and local regression coverage are complete. Existing permission
names remain compatible, explicit `bulk.preview`, `bulk.approve` and `bulk.apply`
capabilities now guard each stage, and identity-level permission snapshots may
only narrow role defaults. Authenticated Project access is the intersection of
owner/Project allowlists, identity membership and current capability. Optional
distinct-Admin approval is available without changing the default individual
workflow. See [M10 richer ACL](M10_RICHER_ACL.md).

## Remaining

- [x] M10-1 durable checkpoint store abstraction
- [x] M10-1 Upstash reuse / namespaced storage
- [x] M10-1 cross-instance restore regression tests
- [x] M10-1 Production cross-request/redeploy validation
- [x] M10-2 durable write audit implementation and regression coverage
- [x] M10-2 Production cross-request/redeploy validation (operator handoff above)
- [x] M10-3 dependency / sub-issue evidence implementation and regression coverage
- [x] M10-3 Production raw MCP relationship validation
- [x] M10-4 guarded relationship write implementation and regression coverage
- [x] M10-4 Production mutation/cleanup/redeploy validation (operator handoff evidence)
- [x] M10-5 implementation and local regression coverage
- [x] M10-5 review / Production validation
- [x] M10-6 richer ACL implementation and regression coverage
- [ ] M10-6 review / Production validation
- [ ] M10-7 final validation / close
