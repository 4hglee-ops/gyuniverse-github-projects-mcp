import assert from "node:assert/strict";
import test from "node:test";
import { createBulkPlan, type BulkPlan, type BulkPlanArtifact } from "./bulk-plan.js";
import { MemoryBulkPlanStore, RedisBulkPlanStore } from "./bulk-plan-store.js";

const artifact: BulkPlanArtifact = {
  version: 1, projectId: "PVT_PROJECT", projectOwner: "gyuniverse-hq", projectNumber: 2,
  createdBy: "user:admin", createdAt: "2026-09-07T00:00:00.000Z", expiresAt: "2026-09-07T00:15:00.000Z",
  operations: [{ index: 0, itemId: "ITEM", field: "Status", fieldId: "FIELD_STATUS",
    before: { optionId: "TODO", name: "Todo" }, after: { optionId: "DONE", name: "Done" } }],
};

class FakeRedis {
  readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, options: { nx: true; ex: number }) {
    assert.equal(options.nx, true); assert.ok(options.ex >= 60);
    if (this.values.has(key)) return null;
    this.values.set(key, value); return "OK";
  }
  async eval(_script: string, keys: string[], args: Array<string | number>) {
    const current = this.values.get(keys[0]!);
    if (!current) return 0;
    const parsed = JSON.parse(current) as BulkPlan;
    if (parsed.state !== args[0] || parsed.planDigest !== args[1]) return 0;
    this.values.set(keys[0]!, String(args[2])); return 1;
  }
}

test("memory plan artifacts are cloned and state transitions compare-and-set", async () => {
  const store = new MemoryBulkPlanStore();
  const plan = createBulkPlan(artifact);
  await store.create(plan);
  const fetched = await store.get(plan.planId);
  assert.ok(fetched);
  fetched.artifact.operations[0]!.after.name = "tampered locally";
  assert.equal((await store.get(plan.planId))?.artifact.operations[0]?.after.name, "Done");
  const approved = { ...plan, state: "approved" as const, approvedBy: "user:admin", approvedAt: artifact.createdAt,
    events: [...plan.events, { type: "approved" as const, actorId: "user:admin", at: artifact.createdAt }] };
  assert.equal(await store.compareAndSet(plan.planId, "approved", approved), false);
  assert.equal(await store.compareAndSet(plan.planId, "previewed", approved), true);
  const applying = { ...approved, state: "applying" as const, applyStartedAt: artifact.createdAt,
    events: [...approved.events, { type: "apply_started" as const, actorId: "user:admin", at: artifact.createdAt }] };
  assert.equal(await store.compareAndSet(plan.planId, "previewed", applying), false);
});

test("redis plans restore across instances and CAS prevents duplicate apply claims", async () => {
  const redis = new FakeRedis();
  const first = new RedisBulkPlanStore(redis);
  const plan = createBulkPlan(artifact);
  await first.create(plan);
  const restored = await new RedisBulkPlanStore(redis).get(plan.planId);
  assert.deepEqual(restored, plan);
  assert.equal(first.persistence.survivesServerRestart, true);
  const approved = { ...plan, state: "approved" as const, approvedBy: "user:admin", approvedAt: artifact.createdAt,
    events: [...plan.events, { type: "approved" as const, actorId: "user:admin", at: artifact.createdAt }] };
  assert.equal(await first.compareAndSet(plan.planId, "previewed", approved), true);
  const applying = { ...approved, state: "applying" as const, applyStartedAt: artifact.createdAt,
    events: [...approved.events, { type: "apply_started" as const, actorId: "user:admin", at: artifact.createdAt }] };
  const [one, two] = await Promise.all([
    first.compareAndSet(plan.planId, "approved", applying),
    new RedisBulkPlanStore(redis).compareAndSet(plan.planId, "approved", applying),
  ]);
  assert.deepEqual([one, two].sort(), [false, true]);
});

test("redis plan parsing fails closed on malformed payload and digest tampering", async () => {
  const redis = new FakeRedis();
  const store = new RedisBulkPlanStore(redis);
  const plan = createBulkPlan(artifact);
  const key = `gyuniverse:m10:bulk-plan:v1:${plan.planId}`;
  redis.values.set(key, "{broken");
  await assert.rejects(() => store.get(plan.planId), /DURABLE_BULK_PLAN_INVALID/);
  redis.values.set(key, JSON.stringify({ ...plan, artifact: { ...plan.artifact, projectOwner: "attacker" } }));
  await assert.rejects(() => store.get(plan.planId), /digest mismatch/);
  await assert.rejects(() => store.get("../unknown"), /BULK_PLAN_ID_INVALID/);
});
