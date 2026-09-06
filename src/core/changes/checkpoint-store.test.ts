import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryProjectCheckpointStore,
  RedisProjectCheckpointStore,
} from "./checkpoint-store.js";
import type { ProjectStateCheckpoint } from "../../workflow/checkpoint.js";

function checkpoint(owner = "gyuniverse-hq", number = 2): ProjectStateCheckpoint {
  return {
    version: 1,
    createdAt: "2026-09-06T00:00:00.000Z",
    sourceSnapshotAt: "2026-09-06T00:00:00.000Z",
    owner,
    project: {
      id: "PVT_allowed",
      number,
      title: "Bid Change Validator · WBS",
      url: "https://github.com/orgs/gyuniverse-hq/projects/2",
    },
    itemCount: 0,
    coverage: {
      requestedItems: 100,
      returnedItems: 0,
      complete: true,
      note: "complete",
    },
    items: [],
  };
}

test("memory checkpoint store remains process-local", async () => {
  const store = new MemoryProjectCheckpointStore();
  await store.set(checkpoint());
  assert.equal(store.persistence.kind, "process_local");
  assert.equal(store.persistence.survivesServerRestart, false);
  assert.equal((await store.get("GYUNIVERSE-HQ", 2))?.project.number, 2);
});

test("redis checkpoint store survives store instances through shared backing data", async () => {
  const data = new Map<string, unknown>();
  const client = {
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
      return "OK";
    },
  };

  const first = new RedisProjectCheckpointStore(client);
  await first.set(checkpoint());

  const second = new RedisProjectCheckpointStore(client);
  const restored = await second.get("gyuniverse-hq", 2);

  assert.equal(second.persistence.kind, "upstash");
  assert.equal(second.persistence.survivesServerRestart, true);
  assert.equal(restored?.createdAt, "2026-09-06T00:00:00.000Z");
});

test("redis checkpoint store fails closed on invalid payload", async () => {
  const store = new RedisProjectCheckpointStore({
    async get() {
      return { version: 99, owner: "gyuniverse-hq", project: { number: 2 }, items: [] };
    },
    async set() {
      return "OK";
    },
  });

  await assert.rejects(
    () => store.get("gyuniverse-hq", 2),
    /DURABLE_CHECKPOINT_INVALID/,
  );
});
