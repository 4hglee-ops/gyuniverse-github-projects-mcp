import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { mutateIssueRelationship, type RelationshipWriteOperation } from "../../github/issue-relationship-mutations.js";
import { AuditService } from "../audit/audit-service.js";
import { MemoryWriteAuditStore, RedisWriteAuditStore, type WriteAuditStoreLike } from "../audit/audit-store.js";
import { principalForRole, type AuthenticatedPrincipal } from "../identity/principal.js";
import { WritePolicy } from "../policy/write-policy.js";
import { ProjectService } from "../projects/project-service.js";
import { ProjectRelationshipService } from "./project-relationship-service.js";
import { RelationshipWriteService } from "./relationship-write-service.js";

const input = { owner: "gyuniverse-hq", number: 2, sourceItemId: "ITEM1", targetItemId: "ITEM2" };
const operations: RelationshipWriteOperation[] = ["add_sub_issue", "remove_sub_issue", "add_blocked_by", "remove_blocked_by"];
const issue = (n: number, owner = "gyuniverse-hq") => ({ id: `ITEM${n}`, content: {
  __typename: "Issue", id: `I${n}`, number: n, title: `Test ${n}`, state: "OPEN",
  url: `https://github.com/${owner}/repo/issues/${n}`, repository: { nameWithOwner: `${owner}/repo` },
} });
const config: AppConfig = { githubToken: "not-a-real-secret", allowedOwners: ["gyuniverse-hq"], allowedProjectIds: ["PVT"], writeEnabled: true };
function fixture(options: {
  principal?: AuthenticatedPrincipal | null; config?: Partial<AppConfig>; store?: WriteAuditStoreLike;
  items?: unknown[]; sub?: readonly string[]; blocked?: readonly string[];
  mutate?: "no_effect" | "throw" | "malformed"; afterRead?: "throw" | "malformed" | "mismatch";
  alterRead?: (node: Record<string, unknown>, count: number) => void;
} = {}) {
  const cfg = { ...config, ...options.config };
  const principal = options.principal === undefined ? principalForRole("actor:admin", "admin", { githubLogin: "4hglee-ops", projectIds: ["PVT"] }) : options.principal;
  const sub = new Set(options.sub ?? []);
  const blocked = new Set(options.blocked ?? []);
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let issueReads = 0;
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      calls.push({ query, variables });
      if (query.includes("mutation GuardedIssueRelationship")) {
        if (options.mutate === "throw") throw new Error("GitHub GraphQL: Bearer secret-pat raw internal cycle payload");
        const args = variables.input as { issueId: string; subIssueId?: string; blockingIssueId?: string; replaceParent?: boolean };
        const target = args.subIssueId ?? args.blockingIssueId!;
        const edges = args.subIssueId ? sub : blocked;
        const edge = `${args.issueId}>${target}`;
        if (query.includes("addSubIssue")) assert.equal(args.replaceParent, false);
        if (options.mutate !== "no_effect") {
          if (/result: add/.test(query)) edges.add(edge); else edges.delete(edge);
        }
        if (options.mutate === "malformed") return { result: { issue: null, target: { id: target } } } as T;
        return { result: { issue: { id: args.issueId }, target: { id: target } } } as T;
      }
      if (query.includes("RelationshipProjectItems")) return { node: { __typename: "ProjectV2", id: "PVT", items: {
        nodes: options.items ?? [issue(1), issue(2), issue(3)], pageInfo: { hasNextPage: false, endCursor: null },
      } } } as T;
      if (query.includes("IssueRelationships")) {
        issueReads++;
        if (issueReads > 2 && options.afterRead === "throw") throw new Error("Bearer secret-pat");
        const id = variables.issueId as string;
        const targets = (edges: Set<string>, reverse = false) => [...edges].map(e => e.split(">"))
          .filter(pair => pair[reverse ? 1 : 0] === id).map(pair => pair[reverse ? 0 : 1]!);
        const connection = (ids: string[]) => ({ nodes: ids.map(id => ({ id })), totalCount: ids.length, pageInfo: { hasNextPage: false, endCursor: null } });
        const parent = targets(sub, true)[0];
        const node: Record<string, unknown> = { __typename: "Issue", id, parent: parent ? { id: parent } : null,
          subIssues: connection(targets(sub)), blockedBy: connection(targets(blocked)), blocking: connection(targets(blocked, true)) };
        if (issueReads > 2 && options.afterRead === "malformed") node.parent = undefined;
        if (issueReads > 2 && options.afterRead === "mismatch") node.id = "WRONG";
        options.alterRead?.(node, issueReads);
        return { node } as T;
      }
      assert.equal(variables.login, "gyuniverse-hq", "actor login is never Project owner");
      return { repositoryOwner: { projectV2: { id: "PVT" } } } as T;
    }
  }
  const client = new Client("test");
  const projects = new ProjectService({ config: cfg, client, principal });
  const reads = new ProjectRelationshipService({ config: cfg, client, projects });
  const audit = new AuditService(200, options.store ?? new MemoryWriteAuditStore());
  const policy = new WritePolicy(cfg, principal);
  return { service: new RelationshipWriteService({ principal, client, projects, reads, writePolicy: policy, audit }),
    client, calls, sub, blocked, audit, reads, policy, issueReads: () => issueReads,
    mutations: () => calls.filter(call => call.query.includes("mutation GuardedIssueRelationship")) };
}

for (const operation of operations) {
  const isSub = operation.endsWith("sub_issue");
  const add = operation.startsWith("add_");
  test(`${operation}: one native mutation, normalized verification in both directions, actor-aware audit`, async () => {
    const f = fixture({ [isSub ? "sub" : "blocked"]: add ? [] : ["I1>I2"] });
    const result = await f.service.execute(operation, input);
    assert.equal(result.changed, true);
    assert.equal(result.before, !add);
    assert.equal(result.after, add);
    assert.equal(result.verified, true);
    assert.equal(result.actorId, "actor:admin");
    assert.equal(f.mutations().length, 1);
    assert.equal(f.issueReads(), 4);
    assert.equal(f.mutations()[0]!.variables.input && (f.mutations()[0]!.variables.input as Record<string, string>).issueId, "I1");
    assert.equal(result.verification.source.coverage.complete, true);
    const [entry] = (await f.audit.list()).entries;
    assert.equal(entry!.id, result.auditId);
    assert.deepEqual(entry!.relationship, { sourceContentId: "I1", targetItemId: "ITEM2", targetContentId: "I2", type: isSub ? "sub_issue" : "blocked_by" });
    assert.equal(entry!.beforeValue, add ? "absent" : "present");
    assert.equal(entry!.afterValue, add ? "present" : "absent");
  });
  test(`${operation}: already requested state re-reads then audits no_change without mutation`, async () => {
    const f = fixture({ [isSub ? "sub" : "blocked"]: add ? ["I1>I2"] : [] });
    const result = await f.service.execute(operation, input);
    assert.equal(result.outcome, "no_change");
    assert.equal(result.changed, false);
    assert.equal(result.verified, true);
    assert.equal(f.mutations().length, 0);
    assert.equal(f.issueReads(), 4);
    assert.equal((await f.audit.list()).entries[0]!.outcome, "no_change");
  });
  test(`${operation}: successful acknowledgement without semantic change fails verification and audits failure`, async () => {
    const f = fixture({ [isSub ? "sub" : "blocked"]: add ? [] : ["I1>I2"], mutate: "no_effect" });
    await assert.rejects(() => f.service.execute(operation, input), /RELATIONSHIP_VERIFICATION_FAILED/);
    assert.equal(f.mutations().length, 1);
    const [entry] = (await f.audit.list()).entries;
    assert.equal(entry!.outcome, "failed");
    assert.equal(entry!.verified, false);
    assert.equal(entry!.errorCode, "RELATIONSHIP_VERIFICATION_FAILED");
  });
}

test("unauthenticated, viewer, member and project.write-only identities cannot execute relationship tools", async () => {
  const member = principalForRole("member", "member", { projectIds: ["PVT"] });
  for (const principal of [null, principalForRole("viewer", "viewer", { projectIds: ["PVT"] }), member]) {
    const f = fixture({ principal });
    await assert.rejects(() => f.service.execute("add_sub_issue", input), /IDENTITY_REQUIRED|PERMISSION_DENIED/);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.audit.list()).entries.length, 0);
  }
  const local = fixture({ principal: null });
  assert.throws(() => local.policy.authorize({ operation: "add_sub_issue", projectId: "PVT" }), /IDENTITY_REQUIRED/);
});

test("owner, Project allowlist/membership, read permission, write permission and write gate remain enforced", async () => {
  const noMembership = principalForRole("admin", "admin", { projectIds: [] });
  const noRead = principalForRole("admin", "admin", { projectIds: ["PVT"] }); noRead.permissions = noRead.permissions.filter(p => p !== "project.read");
  const noWrite = principalForRole("admin", "admin", { projectIds: ["PVT"] }); noWrite.permissions = noWrite.permissions.filter(p => p !== "project.write");
  for (const options of [{ config: { allowedOwners: ["other"] } }, { config: { allowedProjectIds: ["OTHER"] } },
    { config: { allowedProjectIds: [] } }, { config: { writeEnabled: false } }, { principal: noMembership }, { principal: noRead }, { principal: noWrite }]) {
    const f = fixture(options);
    await assert.rejects(() => f.service.execute("add_sub_issue", input));
    assert.equal(f.mutations().length, 0);
    assert.ok(f.calls.every(c => !c.query.includes("Relationship")));
  }
});

test("source outside Project, missing/inaccessible target, unsupported content, malformed inventory and target owner fail closed", async () => {
  for (const items of [[issue(2)], [issue(1)], [issue(1), { id: "ITEM2", content: null }],
    [issue(1), { id: "ITEM2", content: { __typename: "PullRequest" } }],
    [issue(1), { id: "ITEM2", content: { __typename: "DraftIssue" } }],
    [issue(1), issue(2, "private-org")], [issue(1), null]]) {
    const f = fixture({ items });
    await assert.rejects(() => f.service.execute("add_blocked_by", input), /RELATIONSHIP_PRECONDITION_FAILED/);
    assert.equal(f.mutations().length, 0);
    assert.equal((await f.audit.list()).entries[0]!.outcome, "failed");
  }
});

test("self, unknown operations, bulk input and extra fields cannot reach mutations", async () => {
  const f = fixture();
  await assert.rejects(() => f.service.execute("add_sub_issue", { ...input, targetItemId: "ITEM1" }), /SELF_REJECTED/);
  await assert.rejects(() => f.service.execute("replace_parent" as RelationshipWriteOperation, input), /OPERATION_UNSUPPORTED/);
  await assert.rejects(() => mutateIssueRelationship(f.client, "set_relationship" as RelationshipWriteOperation, "I1", "I2"), /OPERATION_UNSUPPORTED/);
  await assert.rejects(() => f.service.execute("add_sub_issue", { ...input, targetItemIds: ["ITEM2"] } as typeof input), /INPUT_INVALID/);
  assert.equal(f.mutations().length, 0);
});

test("add sub-issue never replaces a different parent, even within the same Project", async () => {
  const f = fixture({ sub: ["I3>I2"] });
  await assert.rejects(() => f.service.execute("add_sub_issue", input), /PARENT_EXISTS/);
  assert.equal(f.mutations().length, 0);
});

for (const [operation, edges] of [["add_sub_issue", { sub: ["I2>I3", "I3>I1"] }],
  ["add_blocked_by", { blocked: ["I2>I3", "I3>I1"] }]] as const) {
  test(`${operation}: transitive cycle is rejected before mutation`, async () => {
    const f = fixture({ ...edges });
    await assert.rejects(() => f.service.execute(operation, input), /CYCLE_REJECTED/);
    assert.equal(f.mutations().length, 0);
  });
}

test("cycle scan is bounded and outside-Project cycle evidence never becomes permission to write", async () => {
  const f = fixture({ items: Array.from({ length: 24 }, (_, i) => issue(i + 1)), blocked: Array.from({ length: 21 }, (_, i) => `I${i + 2}>I${i + 3}`) });
  await assert.rejects(() => f.service.execute("add_blocked_by", input), /CYCLE_CHECK_INCOMPLETE/);
  assert.equal(f.mutations().length, 0);
  const hidden = fixture({ blocked: ["I2>HIDDEN"] });
  await assert.rejects(() => hidden.service.execute("add_blocked_by", input), /COVERAGE_INCOMPLETE/);
  assert.equal(hidden.mutations().length, 0);
});

test("truncated relationship coverage and inconsistent reciprocal evidence refuse even no_change", async () => {
  const partial = fixture({ alterRead(node) { if (node.id === "I1") node.blockedBy = { nodes: [{ id: "I3" }], totalCount: 2, pageInfo: { hasNextPage: true, endCursor: "next" } }; } });
  await assert.rejects(() => partial.service.execute("remove_blocked_by", input), /COVERAGE_INCOMPLETE/);
  assert.equal(partial.mutations().length, 0);
  const f = fixture({ alterRead(node) { node.blockedBy = { nodes: [], totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null } }; } });
  await assert.rejects(() => f.service.execute("remove_blocked_by", input), /PRECONDITION_FAILED/);
  const mismatch = fixture({ blocked: ["I1>I2"], alterRead(node) { if (node.id === "I2") node.blocking = { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } }; } });
  await assert.rejects(() => mismatch.service.execute("add_blocked_by", input), /PRECONDITION_FAILED/);
  assert.equal(mismatch.mutations().length, 0);
});

test("different item IDs resolving to the same Issue cannot bypass self protection", async () => {
  const target = issue(1); target.id = "ITEM2";
  const f = fixture({ items: [issue(1), target] });
  await assert.rejects(() => f.service.execute("add_sub_issue", input), /SELF_REJECTED/);
  assert.equal(f.mutations().length, 0);
});

test("raw GitHub failures and malformed mutation acknowledgements are bounded, audited and never retried", async () => {
  for (const mutate of ["throw", "malformed"] as const) {
    const f = fixture({ mutate });
    await assert.rejects(() => f.service.execute("add_sub_issue", input), (error: Error) => {
      assert.match(error.message, /RELATIONSHIP_MUTATION_/);
      assert.ok(!error.message.includes("secret-pat")); return true;
    });
    assert.equal(f.mutations().length, 1);
    const entries = (await f.audit.list()).entries;
    assert.equal(entries[0]!.verified, false);
    assert.ok(!JSON.stringify(entries).includes("secret-pat"));
  }
});

test("post-write read failures, malformed responses and changed node IDs cannot return success", async () => {
  for (const afterRead of ["throw", "malformed", "mismatch"] as const) {
    const f = fixture({ afterRead });
    await assert.rejects(() => f.service.execute("add_sub_issue", input), /VERIFICATION_FAILED/);
    assert.equal(f.mutations().length, 1);
    assert.equal((await f.audit.list()).entries[0]!.afterValue, null);
  }
});

test("no_change still requires a second valid normalized read", async () => {
  const f = fixture({ sub: ["I1>I2"], afterRead: "throw" });
  await assert.rejects(() => f.service.execute("add_sub_issue", input), /VERIFICATION_FAILED/);
  assert.equal(f.mutations().length, 0);
  assert.equal((await f.audit.list()).entries[0]!.outcome, "failed");
});

test("audit persistence failure never returns success or triggers a second write/audit attempt", async () => {
  let appendCount = 0;
  const store: WriteAuditStoreLike = { persistence: { kind: "upstash", survivesServerRestart: true },
    async append() { appendCount++; throw new Error("Redis unavailable"); }, async list() { return []; } };
  const f = fixture({ store });
  await assert.rejects(() => f.service.execute("add_blocked_by", input), /AUDIT_PERSISTENCE_FAILED/);
  assert.equal(f.mutations().length, 1);
  assert.equal(appendCount, 1);
});

test("success and no_change relationship audit restore across Redis store/service instances", async () => {
  const values: unknown[] = [];
  const redis = { async eval(_s: string, _k: string[], args: Array<string | number>) { values.unshift(args[0]); values.splice(Number(args[1])); return 1; },
    async lrange(_key: string, start: number, stop: number) { return values.slice(start, stop + 1); } };
  const f = fixture({ store: new RedisWriteAuditStore(redis) });
  const added = await f.service.execute("add_blocked_by", input);
  const unchanged = await f.service.execute("add_blocked_by", input);
  const restored = await new AuditService(200, new RedisWriteAuditStore(redis)).list();
  assert.equal(restored.persistence, "upstash");
  assert.equal(restored.survivesServerRestart, true);
  assert.deepEqual(restored.entries.map(e => e.id), [unchanged.auditId, added.auditId]);
  assert.deepEqual(restored.entries.map(e => e.outcome), ["no_change", "success"]);
  assert.equal(restored.entries[0]!.relationship!.targetContentId, "I2");
});
