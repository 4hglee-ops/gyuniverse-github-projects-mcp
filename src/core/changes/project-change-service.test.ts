import assert from "node:assert/strict";
import test from "node:test";

import { ProjectChangeService } from "./project-change-service.js";
import { MemoryProjectCheckpointStore, RedisProjectCheckpointStore } from "./checkpoint-store.js";
import { SnapshotService, type ProjectSnapshotReader } from "../snapshots/snapshot-service.js";

class MutableSnapshotReader implements ProjectSnapshotReader {
  constructor(public snapshot: unknown) {}
  async getProjectSnapshot(): Promise<unknown> {
    return this.snapshot;
  }
}

function snapshot(status = "Todo", priority = "P1") {
  return {
    snapshotAt: "2026-09-06T00:00:00.000Z",
    owner: "gyuniverse-hq",
    project: { id: "PVT_allowed", number: 2, title: "Bid Change Validator · WBS" },
    itemCount: 1,
    items: [
      {
        itemId: "I1",
        contentId: "C1",
        contentType: "Issue",
        repository: "gyuniverse-hq/app",
        number: 1,
        title: "Work",
        url: "https://example/1",
        state: "OPEN",
        merged: null,
        assignees: ["4hglee-ops"],
        fields: { Status: status, Priority: priority },
      },
    ],
  };
}

function memoryChanges(reader: MutableSnapshotReader) {
  return new ProjectChangeService(
    new SnapshotService(reader),
    new MemoryProjectCheckpointStore(),
  );
}

test("getChanges can initialize a missing baseline without reporting synthetic deltas", async () => {
  const reader = new MutableSnapshotReader(snapshot());
  const changes = memoryChanges(reader);

  const result = await changes.getChanges("gyuniverse-hq", 2, { initializeIfMissing: true });
  assert.equal(result.baselineInitialized, true);
  assert.equal(result.comparison, null);
  assert.equal(result.changes.status.length, 0);
  assert.equal(result.checkpointReplaced, false);
  assert.deepEqual(result.persistence, {
    kind: "process_local",
    survivesServerRestart: false,
  });
});

test("getChanges groups semantic status and priority deltas against the shared baseline", async () => {
  const reader = new MutableSnapshotReader(snapshot());
  const changes = memoryChanges(reader);
  await changes.captureBaseline("gyuniverse-hq", 2, 100);

  reader.snapshot = snapshot("In Progress", "P0");
  const result = await changes.getChanges("gyuniverse-hq", 2, { first: 100 });

  assert.equal(result.baselineInitialized, false);
  assert.equal(result.comparison?.hasChanges, true);
  assert.equal(result.comparison?.summary.statusChangedCount, 1);
  assert.equal(result.comparison?.summary.priorityChangedCount, 1);
  assert.equal(result.changes.status[0]?.before, "Todo");
  assert.equal(result.changes.status[0]?.after, "In Progress");
  assert.equal(result.changes.priority[0]?.after, "P0");
  assert.equal(result.checkpointReplaced, false);
});

test("getChanges fails closed when no baseline exists and initialization is not requested", async () => {
  const reader = new MutableSnapshotReader(snapshot());
  const changes = memoryChanges(reader);
  await assert.rejects(
    () => changes.getChanges("gyuniverse-hq", 2),
    /No checkpoint exists/,
  );
});

test("durable checkpoint can be restored by a new ProjectChangeService instance", async () => {
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

  const initialReader = new MutableSnapshotReader(snapshot());
  const firstService = new ProjectChangeService(
    new SnapshotService(initialReader),
    new RedisProjectCheckpointStore(client),
  );
  const captured = await firstService.captureBaseline("gyuniverse-hq", 2, 100);
  assert.equal(captured.persistence.kind, "upstash");
  assert.equal(captured.persistence.survivesServerRestart, true);

  const secondReader = new MutableSnapshotReader(snapshot("In Progress", "P1"));
  const secondService = new ProjectChangeService(
    new SnapshotService(secondReader),
    new RedisProjectCheckpointStore(client),
  );
  const result = await secondService.getChanges("gyuniverse-hq", 2, { first: 100 });

  assert.equal(result.persistence.kind, "upstash");
  assert.equal(result.comparison?.summary.statusChangedCount, 1);
  assert.equal(result.changes.status[0]?.before, "Todo");
  assert.equal(result.changes.status[0]?.after, "In Progress");
});
