# M10-4 Guarded single-relationship writes

M10-4 adds four MCP tools backed by `RelationshipWriteService`. M10-3 relationship reads, ordinary snapshots, blocker inference, checkpoints and their authorization remain unchanged. The original milestone did not add REST/GPT Action endpoints; the later Actions integration exposes the same service and controls without changing the relationship model. Relationship bulk operations remain unsupported.

## Native API mapping and direction

All tools take `{ owner, number, sourceItemId, targetItemId }`. Both IDs must resolve to GitHub Issues in the **same authorized Project**, with allowed repository owners. Inputs do not accept arbitrary Issue URLs, arrays, relationship type switches, or extra fields.

| MCP tool | GitHub mutation | Meaning |
| --- | --- | --- |
| `add_github_project_sub_issue` | `addSubIssue` | Source is parent, target is child |
| `remove_github_project_sub_issue` | `removeSubIssue` | Detach target child from source parent; delete neither Issue |
| `add_github_project_blocked_by` | `addBlockedBy` | Source is blocked by target; target blocks source |
| `remove_github_project_blocked_by` | `removeBlockedBy` | Remove that exact directed dependency |

The [GitHub GraphQL Issue reference](https://docs.github.com/en/graphql/reference/issues) specifies `issueId` plus `subIssueId` for hierarchy mutations, and `issueId` plus `blockingIssueId` for dependencies. We always send `replaceParent=false` for `addSubIssue`. The read model's `parent`/`subIssues` and `blocks`/`blockedBy` pairs are reciprocal views, not four independent classes of writes. To express “A blocks B,” call `add_github_project_blocked_by` with source B and target A.

Unsupported by this milestone: implicit reparenting, sub-issue ordering, cross-Project edges, targets absent from the authorized inventory, generic relationship mutation, multi-edge batches, automatic rollback/retry, and writes inferred from labels/body/status. GitHub may reject structural limits, cycles, permissions or concurrent edits; raw GraphQL failure bodies are not returned or stored.

## Authorization and registration

- An authenticated principal is mandatory, including local use. No anonymous/local-PAT compatibility bypass for these new operations.
- Require `project.read`, `project.write`, `item.relationship.write`, explicit Project write allowlist, principal Project membership and existing global write gate.
- `item.relationship.write` is granted only to the existing `admin` role. Member and viewer roles do not inherit it merely through `project.write`.
- Remote OAuth still requires `projects:write`; a read-scope token cannot override the disabled effective write gate even for an admin.
- The underlying GitHub credential must itself have appropriate Issue write and Project read access. No GitHub token scopes or environment settings are changed by this PR.
- Follow existing registration convention: tools are listed, but invocation is rejected at runtime for unauthorized identities. MCP annotations are hints, not authorization. Existing viewer relationship reads remain available.
- Project owner is taken from the explicit request; `githubLogin` is never used as owner. Current owner is `gyuniverse-hq`, not actor login `4hglee-ops`.

Full per-Project role overrides, delegation, policy editing, approval flows and bulk permission management remain M10-5/M10-6 work.

## Preconditions, cycles and coverage

Every write resolves source and target through the existing M10-3 normalized relationship read service. The Project inventory must be complete (currently at most 1,000 items), with no inaccessible Project content. Required forward and reverse relationship groups must both have complete coverage (at most 100 per connection, no withheld targets). Incomplete evidence fails closed even if a likely matching edge was seen.

The service rejects self-relations, mismatched source/target IDs, reciprocal disagreement, missing/inaccessible targets and unsupported content types. Adding a child already parented elsewhere never moves it implicitly. Removing an absent edge is no-change and leaves any other parent/dependency untouched.

Before a new add, traverse source's parent chain (sub-issues) or target's transitive blocked-by graph (dependencies). Reaching the opposite endpoint rejects the cycle. Cycle exploration is bounded to 20 scheduled nodes, each using the same authorized normalized read path. Truncation, withheld edges or exceeding this bound denies the write. No cycle traversal is necessary for removals or existing-edge no-change adds.

These are conservative, bounded operations, not an atomic graph transaction. External concurrent edits can race preflight/verification; GitHub remains the mutation authority. We do not claim distributed locking, exactly-once mutation, a serializable snapshot, or prevention of every cross-client race.

## Idempotency and verification

1. Authenticate, resolve Project and authorize the specific operation before content reads/mutation.
2. Read source and target, require complete and consistent reciprocal evidence, and record the before state.
3. Validate add-only parent/cycle preconditions when a new edge is needed.
4. Execute exactly one native mutation, or none when already at the requested state.
5. Validate both returned Issue IDs in the mutation acknowledgement. A malformed acknowledgement is a failure with potentially changed state, not success.
6. For success and no-change paths, freshly re-read **both endpoints through M10-3**. Prove source `subIssues` + target `parent`, or source `blockedBy` + target `blocks`, match the requested presence/absence with complete coverage.
7. Persist audit, then return `verified=true`, boolean `before`/`after`, `changed`, `outcome`, actor/audit IDs and normalized verification evidence.

Adding an existing edge and removing an absent edge return `outcome=no_change`, `changed=false` only after fresh verification, and each creates a new audit record. Thus semantic relationship state is idempotent, but audit appends are intentionally not deduplicated.

`RELATIONSHIP_MUTATION_FAILED` covers a GitHub rejection or unknown network outcome without leaking raw internals. `RELATIONSHIP_MUTATION_RESPONSE_INVALID` means acknowledgement could not be trusted. Unproven final state is a failure, never success. `AUDIT_PERSISTENCE_FAILED` means audit storage failed, potentially after a verified GitHub change. **Do not blindly retry any of these failures or automatically remove a relationship as rollback.** Re-read state and coordinate cleanup with the operator.

## Durable audit compatibility

Reuse `AuditService`, Upstash selection, existing `gyuniverse:m10:audit:v1:entries` retention, atomic append/trim, actor IDs and timestamps. Existing fields record operation, source Project/item, requested/before/after `present` or `absent`, outcome, verified and bounded error code. Authorized precondition failures are audited; identity/Project/write-policy rejections follow the existing convention of failing before audit append.

An optional, allowlisted `relationship` object adds `sourceContentId`, `targetItemId`, `targetContentId` (each at most 256 characters), and type `sub_issue` or `blocked_by`. These fields are populated only after endpoint resolution. Tokens, raw mutation arguments, extra nested properties and raw failure messages are never persisted by this path. Unknown after-state stays null rather than being reported absent.

New readers accept both legacy records and the optional extension; existing non-relationship writes keep their old shape. No migration or deletion of historical records is performed. **Rollback caution:** pre-M10-4 binaries use an exact-key audit validator and cannot read records containing the new optional field. After relationship audit records exist, retain the new reader during any rollback (forward-fix/backport) rather than rolling back to an unmodified pre-M10-4 binary or deleting history. Mixed-version audit readers have the same limitation.

## Safe Production validation and cleanup (after review and merge only)

No Production mutation is performed by this implementation PR. Never use Issue #4; it remains the validated read-only fixture.

1. Prefer two newly approved disposable Issues titled `[M10-4 validation] parent-or-blocked` and `[M10-4 validation] child-or-blocker`, added to `gyuniverse-hq` Project #2. Creating them requires separate operator approval. Alternatively re-use M8 validation Issues #8/#9 only after the operator confirms they are disposable and current native relationships are empty.
2. Record exact source/target Issue URLs, content IDs and Project item IDs. Confirm admin identity, `item.relationship.write`, Project membership, OAuth write scope and intended write gate. Do not change env values as a workaround.
3. Read both endpoints and establish complete empty baseline. Stop if either has existing relationships or incomplete coverage.
4. Add source-parent → target-child using `add_github_project_sub_issue`. Verify `success`, both directions and the matching Upstash audit entry.
5. Repeat the add to prove `no_change`, then remove using the exact same pair. Verify no child/parent edge remains, and repeat the remove to prove no-change. Capture all four audit IDs.
6. With baseline empty again, perform the same add/no-change/remove/no-change sequence for `add_github_project_blocked_by` / `remove_github_project_blocked_by`. Source is the blocked Issue; target is its blocker. Capture four more audit IDs.
7. Re-read both Issues and all four relationship groups; confirm no test relationship remains. On any ambiguous error, stop mutation attempts and inspect actual state before an explicitly authorized cleanup operation.
8. After explicit operator redeploy approval, redeploy unchanged Production and re-list the captured audit IDs with `persistence=upstash` and `survivesServerRestart=true`. Check checkpoint and read regressions without replacing their baseline.
9. Confirm both pairs of relationships are still absent. Close/archive disposable fixture Issues/items only with separate approval, and report any retained fixtures.

Only after this reviewed Production validation should M10-4 be closed and M10-5 begin.
