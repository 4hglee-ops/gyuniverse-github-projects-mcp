import assert from "node:assert/strict";
import test from "node:test";

import { SnapshotService } from "./snapshot-service.js";

test("SnapshotService delegates snapshot reads and reports bounded coverage", async () => {
  const calls: unknown[][] = [];
  const service = new SnapshotService({
    async getProjectSnapshot(owner, number, first) {
      calls.push([owner, number, first]);
      return {
        snapshotAt: "2026-09-05T00:00:00.000Z",
        owner,
        itemCount: 2,
        items: [{ itemId: "1" }, { itemId: "2" }],
      };
    },
  });

  const snapshot = await service.getSnapshot("gyuniverse-hq", 2, 50);
  assert.deepEqual(calls, [["gyuniverse-hq", 2, 50]]);
  assert.equal(snapshot.itemCount, 2);
  assert.deepEqual(service.coverage(snapshot, 50, "bounded"), {
    requestedItems: 50,
    returnedItems: 2,
    completeBeyondFirstPage: false,
    note: "bounded",
  });
});
