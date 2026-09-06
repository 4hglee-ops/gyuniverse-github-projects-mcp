import assert from "node:assert/strict";
import test from "node:test";

import { MemoryWriteAuditStore, RedisWriteAuditStore } from "./audit-store.js";

const base = {
  operation: "update_status",
  outcome: "success" as const,
  actorId: "user:member",
  projectId: "PVT_PROJECT",
  projectOwner: "gyuniverse-hq",
  projectNumber: 2,
  itemId: "PVTI_ITEM",
  fieldName: "Status",
  requestedValue: "Done",
  beforeValue: "In Progress",
  afterValue: "Done",
  verified: true,
  errorCode: null,
};

class FakeRedisAuditClient {
  readonly values = new Map<string, unknown[]>();

  async eval(_script: string, keys: string[], args: Array<string | number>) {
    const key = keys[0] as string;
    const entries = this.values.get(key) ?? [];
    entries.unshift(args[0]);
    entries.splice(Number(args[1]));
    this.values.set(key, entries);
    return 1;
  }

  async lrange(key: string, start: number, stop: number) {
    return (this.values.get(key) ?? []).slice(start, stop + 1);
  }
}

test("memory audit persistence is bounded within the same store", async () => {
  const store = new MemoryWriteAuditStore(2);
  await store.append({ ...base, itemId: "first" });
  await store.append({ ...base, itemId: "second" });
  await store.append({ ...base, itemId: "third" });

  assert.equal(store.persistence.kind, "process_local");
  assert.deepEqual((await store.list()).map((entry) => entry.itemId), ["third", "second"]);
});

test("redis audit history restores across instances with newest-first ordering and retention", async () => {
  const redis = new FakeRedisAuditClient();
  const first = new RedisWriteAuditStore(redis, 2);
  await first.append({ ...base, itemId: "first" });
  await first.append({ ...base, itemId: "second" });
  await first.append({ ...base, itemId: "third" });

  const second = new RedisWriteAuditStore(redis, 2);
  const restored = await second.list();
  assert.equal(second.persistence.kind, "upstash");
  assert.equal(second.persistence.survivesServerRestart, true);
  assert.deepEqual(restored.map((entry) => entry.itemId), ["third", "second"]);
});

test("redis audit filters still work across the retained history", async () => {
  const redis = new FakeRedisAuditClient();
  const store = new RedisWriteAuditStore(redis, 10);
  await store.append(base);
  await store.append({ ...base, projectId: "PVT_OTHER", itemId: "PVTI_OTHER" });

  assert.deepEqual((await store.list({ projectId: "PVT_PROJECT" })).map((entry) => entry.projectId), ["PVT_PROJECT"]);
  assert.deepEqual((await store.list({ itemId: "PVTI_OTHER" })).map((entry) => entry.itemId), ["PVTI_OTHER"]);
});

test("redis audit fails closed on malformed stored payloads", async () => {
  const redis = new FakeRedisAuditClient();
  redis.values.set("gyuniverse:m10:audit:v1:entries", ["{not-json"]);
  const store = new RedisWriteAuditStore(redis);

  await assert.rejects(() => store.list(), /DURABLE_AUDIT_INVALID/);
});

test("redis audit persists only bounded allowlisted metadata", async () => {
  const redis = new FakeRedisAuditClient();
  const store = new RedisWriteAuditStore(redis);
  await store.append({
    ...base,
    requestedValue: "x".repeat(700),
    bearerToken: "secret-token",
    rawMutationPayload: { body: "secret" },
  } as typeof base & { bearerToken: string; rawMutationPayload: object });

  const raw = String(redis.values.values().next().value?.[0]);
  assert.equal(raw.includes("secret-token"), false);
  assert.equal(raw.includes("rawMutationPayload"), false);
  assert.equal((await store.list())[0]?.requestedValue?.length, 512);
});
