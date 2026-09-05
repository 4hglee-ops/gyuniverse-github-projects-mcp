import assert from "node:assert/strict";
import test from "node:test";

import { ProjectChangeService } from "./project-change-service.js";
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

test("getChanges can initialize a missing baseline without reporting synthetic deltas", async () => {
  const reader = new MutableSnapshotReader(snapshot());
  const changes = new ProjectChangeService(new SnapshotService(reader));

  const result = await changes.getChanges("gyuniverse-hq", 2, { initializeIfMissing: true });
  assert.equal(result.baselineInitialized, true);
  assert.equal(result.comparison, null);
  assert.equal(result.changes.status.length, 0);
  assert.equal(result.checkpointReplaced, false);
});

test("getChanges groups semantic status and priority deltas against the shared baseline", async () => {
  const reader = new MutableSnapshotReader(snapshot());
  const changes = new ProjectChangeService(new SnapshotService(reader));
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
  const changes = new ProjectChangeService(new SnapshotService(reader));
  await assert.rejects(
    () => changes.getChanges("gyuniverse-hq", 2),
    /No process-local checkpoint exists/,
  );
});
