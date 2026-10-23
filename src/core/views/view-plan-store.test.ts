import assert from "node:assert/strict";
import test from "node:test";
import { createViewPlan, viewDigest, type ViewPlan } from "./view-plan.js";
import { MemoryViewPlanStore, RedisViewPlanStore, type ViewRedis } from "./view-plan-store.js";
import { createViewPlanStore } from "./view-plan-store-factory.js";

function plan() {
  const now = Date.now();
  return createViewPlan({ version: 1, kind: "template", owner: "fixture-org", number: 3, projectId: "PVT", createdBy: "fixture-admin",
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString(), baselineDigest: viewDigest("baseline"),
    actions: [{ action: "skip-compatible", name: "Existing", reason: "preserve", manual: [], viewId: "V", create: null, changes: null, expected: null }],
  });
}
/** In-memory Redis contract double; actual Redis/Lua execution is intentionally not contacted. */
class RedisDouble implements ViewRedis {
  readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, _options: { nx: true; ex: number }) {
    if (this.values.has(key)) return null;
    this.values.set(key, value); return "OK";
  }
  async eval(script: string, keys: string[], args: Array<string | number>) {
    const raw = this.values.get(keys[0]!);
    if (!raw) return 0;
    const current = JSON.parse(raw) as ViewPlan;
    if (current.planDigest !== args[0]) return 0;
    if (script.includes("EXISTS")) {
      if (current.state !== "previewed" || current.artifact.projectId !== args[1] || this.values.has(keys[1]!)) return 0;
      const next = JSON.parse(String(args[2])) as ViewPlan;
      assert.ok(Array.isArray(next.results), "Empty arrays must survive the Lua state transition");
      this.values.set(keys[1]!, current.planId); this.values.set(keys[0]!, String(args[2])); return 1;
    }
    if (current.state !== "applying" || this.values.get(keys[1]!) !== current.planId) return 0;
    this.values.set(keys[0]!, String(args[1])); if (args[2] === "release") this.values.delete(keys[1]!); return 1;
  }
}
test("Both stores isolate snapshots and serialize same-plan and cross-plan Project claims", async () => {
  for (const store of [new MemoryViewPlanStore(), new RedisViewPlanStore(new RedisDouble())]) {
    const one = plan(), two = plan(); await store.create(one); await store.create(two);
    const read = (await store.get(one.planId))!; read.artifact.owner = "modified-copy";
    assert.equal((await store.get(one.planId))!.artifact.owner, "fixture-org");
    const results = await Promise.all([store.claim(one), store.claim(one), store.claim(two)]);
    assert.equal(results.filter(Boolean).length, 1);
    const claimed = results[0] || results[1] ? one : two, pending = claimed === one ? two : one;
    assert.equal((await store.get(claimed.planId))!.state, "applying");
    await store.finish({ ...claimed, state: "completed" });
    assert.equal(await store.claim(pending), true);
    await store.finish({ ...pending, state: "completed" });
    assert.equal(await store.claim(claimed), false);
  }
});
test("Uncertain mutations retain the Project lock; corrupted durable rows fail closed", async () => {
  for (const store of [new MemoryViewPlanStore(), new RedisViewPlanStore(new RedisDouble())]) {
    const one = plan(), two = plan(); await store.create(one); await store.create(two);
    assert.equal(await store.claim(one), true);
    await store.finish({ ...one, state: "partial", results: [{ name: "Existing", viewId: null, changed: null, verified: false, outcome: "failed", errorCode: "VIEW_UPSTREAM_503" }] });
    assert.equal(await store.claim(two), false);
  }
  const redis = new RedisDouble(), store = new RedisViewPlanStore(redis), original = plan();
  await store.create(original);
  const key = [...redis.values.keys()][0]!;
  redis.values.set(key, JSON.stringify({ ...original, artifact: { ...original.artifact, number: 2 } }));
  await assert.rejects(() => store.get(original.planId), /VIEW_PLAN_INVALID/);
  await assert.rejects(() => store.get("untrusted/key"), /VIEW_PLAN_ID_INVALID/);
});
test("Durable plan state survives store reconstruction and rejects invalid finalization", async () => {
  const redis = new RedisDouble(), first = new RedisViewPlanStore(redis), original = plan();
  await first.create(original);
  const second = new RedisViewPlanStore(redis);
  assert.deepEqual(await second.get(original.planId), original);
  await assert.rejects(() => second.finish({ ...original, state: "completed" }), /VIEW_PLAN_STATE_CONFLICT/);
  assert.equal(await second.claim(original), true);
  await second.finish({ ...original, state: "completed" });
  assert.equal((await first.get(original.planId))!.state, "completed");
});
test("Local factory shares plans across request services and refuses non-durable deployed plans", () => {
  const mode = process.env.M10_GOVERNANCE_STORE, env = process.env.VERCEL_ENV, nodeEnv = process.env.NODE_ENV;
  try {
    process.env.M10_GOVERNANCE_STORE = "memory"; process.env.VERCEL_ENV = "development"; process.env.NODE_ENV = "test";
    assert.equal(createViewPlanStore(), createViewPlanStore());
    process.env.VERCEL_ENV = "production";
    assert.throws(() => createViewPlanStore(), /VIEW_PLAN_DURABILITY_REQUIRED/);
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => createViewPlanStore(), /VIEW_PLAN_DURABILITY_REQUIRED/);
    process.env.VERCEL_ENV = "development"; process.env.NODE_ENV = "production";
    assert.throws(() => createViewPlanStore(), /VIEW_PLAN_DURABILITY_REQUIRED/);
  } finally {
    if (mode === undefined) delete process.env.M10_GOVERNANCE_STORE; else process.env.M10_GOVERNANCE_STORE = mode;
    if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  }
});

test("Redis transport failures never expose connection details or stored payloads", async () => {
  class FailedRedis extends RedisDouble {
    override async get(): Promise<never> { throw new Error("private-connection-details"); }
    override async set(): Promise<never> { throw new Error("private-command-payload"); }
  }
  const store = new RedisViewPlanStore(new FailedRedis()), original = plan();
  for (const run of [() => store.get(original.planId), () => store.create(original)]) {
    await assert.rejects(run, (error: Error) => { assert.match(error.message, /VIEW_PLAN_STORE_UNAVAILABLE/); assert.doesNotMatch(error.message, /private-/); return true; });
  }
});
