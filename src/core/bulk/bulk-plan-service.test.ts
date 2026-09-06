import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import type { NamedSingleSelectPreview, NamedSingleSelectUpdateInput } from "../../workflow/single-select-update.js";
import { AuditService } from "../audit/audit-service.js";
import { MemoryWriteAuditStore } from "../audit/audit-store.js";
import type { WriteAuditStoreLike } from "../audit/audit-store.js";
import { principalForRole, type AuthenticatedPrincipal } from "../identity/principal.js";
import { WritePolicy } from "../policy/write-policy.js";
import { MemoryBulkPlanStore } from "./bulk-plan-store.js";
import { BulkPlanService } from "./bulk-plan-service.js";

const config: AppConfig = { githubToken: "test", allowedOwners: ["gyuniverse-hq"], allowedProjectIds: ["PVT_PROJECT"], writeEnabled: true };
const admin = principalForRole("user:admin", "admin", { projectIds: ["PVT_PROJECT"] });

interface FixtureOptions {
  principal?: AuthenticatedPrincipal;
  store?: MemoryBulkPlanStore;
  now?: Date;
  failAtUpdate?: number;
  auditStore?: WriteAuditStoreLike;
}

function fixture(options: FixtureOptions = {}) {
  const principal = options.principal ?? admin;
  const store = options.store ?? new MemoryBulkPlanStore();
  const audit = new AuditService(200, options.auditStore ?? new MemoryWriteAuditStore());
  const states = new Map<string, { id: string; name: string } | null>([
    ["ITEM1\0Status", { id: "S_TODO", name: "Todo" }],
    ["ITEM2\0Priority", null],
    ["ITEM3\0Status", { id: "S_BACKLOG", name: "Backlog" }],
  ]);
  const optionsByName: Record<string, { id: string; name: string }> = {
    "In Progress": { id: "S_PROGRESS", name: "In Progress" },
    Todo: { id: "S_TODO", name: "Todo" },
    P1: { id: "P1", name: "P1" },
  };
  const updates: NamedSingleSelectUpdateInput[] = [];
  let currentNow = options.now ?? new Date("2026-09-07T00:00:00.000Z");
  const inspect = async (_client: GitHubGraphQlClient, input: NamedSingleSelectUpdateInput): Promise<NamedSingleSelectPreview> => {
    const requested = optionsByName[input.optionName];
    if (!requested) throw new Error("PROJECT_FIELD_OPTION_NOT_FOUND: missing option");
    return {
      project: { id: input.projectId, number: input.projectNumber, title: "Project" }, itemId: input.itemId,
      field: { id: input.fieldName === "Status" ? "FIELD_STATUS" : "FIELD_PRIORITY", name: input.fieldName },
      requestedOption: requested, current: states.get(`${input.itemId}\0${input.fieldName}`) ?? null,
    };
  };
  const update = async (client: GitHubGraphQlClient, input: NamedSingleSelectUpdateInput) => {
    updates.push(input);
    if (options.failAtUpdate === updates.length) throw new Error("GITHUB_RUNTIME_FAILURE: simulated outage");
    const before = (await inspect(client, input)).current;
    if ((before?.id ?? null) !== input.expectedCurrentOptionId) throw new Error("PLAN_STALE: changed after preflight");
    const after = optionsByName[input.optionName]!;
    const changed = before?.id !== after.id;
    states.set(`${input.itemId}\0${input.fieldName}`, after);
    return {
      changed, verified: true, project: { id: input.projectId, number: input.projectNumber, title: "Project" },
      itemId: input.itemId, field: { id: input.fieldName === "Status" ? "FIELD_STATUS" : "FIELD_PRIORITY", name: input.fieldName },
      requestedOption: after, before, after, mutationSkippedReason: changed ? null : "already_at_requested_option",
    };
  };
  const service = new BulkPlanService({
    client: {} as GitHubGraphQlClient,
    projects: { async resolveProject() { return { id: "PVT_PROJECT" }; } },
    principal, writePolicy: new WritePolicy(config, principal), audit, store,
    now: () => new Date(currentNow), inspect, update,
  });
  return { service, store, audit, states, updates, setNow(value: string) { currentNow = new Date(value); } };
}

const requests = [
  { itemId: "ITEM1", field: "Status" as const, value: "In Progress" },
  { itemId: "ITEM2", field: "Priority" as const, value: "P1" },
];

test("immutable preview, explicit same-admin approval, single-use apply and correlated item audits", async () => {
  const f = fixture();
  const preview = await f.service.preview("gyuniverse-hq", 2, requests);
  assert.equal(preview.state, "previewed");
  assert.equal(preview.artifact.createdBy, "user:admin");
  assert.deepEqual(preview.artifact.operations.map(({ before, after }) => ({ before, after })), [
    { before: { optionId: "S_TODO", name: "Todo" }, after: { optionId: "S_PROGRESS", name: "In Progress" } },
    { before: { optionId: null, name: null }, after: { optionId: "P1", name: "P1" } },
  ]);
  assert.equal(f.updates.length, 0);

  const approved = await f.service.approve(preview.planId, preview.planDigest);
  assert.equal(approved.state, "approved");
  assert.equal(approved.approvedBy, "user:admin");
  assert.equal(f.updates.length, 0);
  assert.deepEqual(approved.events.map((event) => event.type), ["preview_created", "approved"]);

  const applied = await f.service.apply(preview.planId, preview.planDigest);
  assert.equal(applied.state, "completed");
  assert.equal(applied.results.length, 2);
  assert.equal(f.updates.length, 2);
  assert.deepEqual(applied.events.map((event) => event.type), ["preview_created", "approved", "apply_started", "apply_completed"]);
  const audits = await f.audit.list();
  assert.equal(audits.entries.length, 2);
  assert.ok(audits.entries.every((entry) => entry.planId === preview.planId && entry.verified));

  const duplicate = await f.service.apply(preview.planId, preview.planDigest);
  assert.deepEqual(duplicate, applied);
  assert.equal(f.updates.length, 2);
  assert.equal((await f.audit.list()).entries.length, 2);
});

test("stale preflight performs zero mutations and terminally fails the plan", async () => {
  const f = fixture();
  const plan = await f.service.preview("gyuniverse-hq", 2, requests);
  await f.service.approve(plan.planId, plan.planDigest);
  f.states.set("ITEM2\0Priority", { id: "P2", name: "P2" });
  const result = await f.service.apply(plan.planId, plan.planDigest);
  assert.equal(result.state, "failed");
  assert.equal(result.results.length, 0);
  assert.equal(result.events.at(-1)?.errorCode, "PLAN_STALE");
  assert.equal(f.updates.length, 0);
  assert.equal((await f.audit.list()).entries.length, 0);
});

test("runtime failure after preflight is partial, stops remaining work, and is not retried", async () => {
  const f = fixture({ failAtUpdate: 2 });
  const plan = await f.service.preview("gyuniverse-hq", 2, [
    ...requests, { itemId: "ITEM3", field: "Status", value: "Todo" },
  ]);
  await f.service.approve(plan.planId, plan.planDigest);
  const result = await f.service.apply(plan.planId, plan.planDigest);
  assert.equal(result.state, "partial");
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((item) => item.outcome), ["success", "failed"]);
  assert.equal(result.results[1]?.errorCode, "GITHUB_RUNTIME_FAILURE");
  assert.equal(f.updates.length, 2);
  assert.equal(f.states.get("ITEM3\0Status")?.name, "Backlog");
  assert.equal((await f.audit.list()).entries.length, 2);
  await f.service.apply(plan.planId, plan.planDigest);
  assert.equal(f.updates.length, 2);
});

test("an unchanged item still receives verified no-change audit correlation", async () => {
  const f = fixture();
  const plan = await f.service.preview("gyuniverse-hq", 2, [{ itemId: "ITEM1", field: "Status", value: "Todo" }]);
  await f.service.approve(plan.planId, plan.planDigest);
  const result = await f.service.apply(plan.planId, plan.planDigest);
  assert.equal(result.state, "completed");
  assert.equal(result.results[0]?.outcome, "no_change");
  assert.equal(result.results[0]?.changed, false);
  assert.equal((await f.audit.list()).entries[0]?.planId, plan.planId);
});

test("audit persistence failure is terminal and never retries the audit or remaining writes", async () => {
  let appendCalls = 0;
  const failingAudit: WriteAuditStoreLike = {
    persistence: { kind: "upstash", survivesServerRestart: true },
    async append() { appendCalls += 1; throw new Error("provider secret must not escape"); },
    async list() { return []; },
  };
  const f = fixture({ auditStore: failingAudit });
  const plan = await f.service.preview("gyuniverse-hq", 2, requests);
  await f.service.approve(plan.planId, plan.planDigest);
  const result = await f.service.apply(plan.planId, plan.planDigest);
  assert.equal(result.state, "failed");
  assert.equal(result.results[0]?.errorCode, "AUDIT_PERSISTENCE_FAILED");
  assert.equal(result.results[0]?.changed, true);
  assert.equal(result.results[0]?.verified, true);
  assert.equal(appendCalls, 1);
  assert.equal(f.updates.length, 1);
});

test("plans expire before approval/apply and digest mismatch cannot approve", async () => {
  const f = fixture();
  const plan = await f.service.preview("gyuniverse-hq", 2, requests);
  await assert.rejects(() => f.service.approve(plan.planId, "x".repeat(43)), /BULK_PLAN_DIGEST_MISMATCH/);
  f.setNow("2026-09-07T00:16:00.000Z");
  await assert.rejects(() => f.service.approve(plan.planId, plan.planDigest), /BULK_PLAN_NOT_APPROVABLE/);
  assert.equal((await f.service.get(plan.planId)).state, "expired");
  assert.equal(f.updates.length, 0);
});

test("M10-5 requires the same authenticated admin and enforces bounds", async () => {
  const shared = new MemoryBulkPlanStore();
  const creator = fixture({ store: shared });
  const plan = await creator.service.preview("gyuniverse-hq", 2, requests);
  const other = fixture({ store: shared, principal: principalForRole("user:other", "admin", { projectIds: ["PVT_PROJECT"] }) });
  await assert.rejects(() => other.service.approve(plan.planId, plan.planDigest), /BULK_PLAN_ACTOR_MISMATCH/);
  const member = fixture({ principal: principalForRole("user:member", "member", { projectIds: ["PVT_PROJECT"] }) });
  await assert.rejects(() => member.service.preview("gyuniverse-hq", 2, requests), /BULK_ADMIN_REQUIRED/);
  await assert.rejects(() => creator.service.preview("gyuniverse-hq", 2, []), /BULK_PLAN_SIZE_INVALID/);
  await assert.rejects(() => creator.service.preview("gyuniverse-hq", 2, Array.from({ length: 21 }, (_, i) => ({ itemId: `I${i}`, field: "Status", value: "Todo" }))), /BULK_PLAN_SIZE_INVALID/);
  await assert.rejects(() => creator.service.preview("gyuniverse-hq", 2, [requests[0]!, requests[0]!]), /BULK_PLAN_DUPLICATE_TARGET/);
});
