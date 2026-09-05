import assert from "node:assert/strict";
import test from "node:test";

import { HighLevelReadService } from "./high-level-read-service.js";
import { SnapshotService, type ProjectSnapshotReader } from "../snapshots/snapshot-service.js";

class StubSnapshotReader implements ProjectSnapshotReader {
  constructor(private readonly snapshot: unknown) {}
  async getProjectSnapshot(): Promise<unknown> {
    return this.snapshot;
  }
}

function service() {
  const snapshot = {
    snapshotAt: "2026-09-06T00:00:00.000Z",
    owner: "gyuniverse-hq",
    project: { id: "PVT_allowed", number: 2, title: "Bid Change Validator · WBS" },
    itemCount: 5,
    items: [
      { itemId: "I1", contentId: "C1", contentType: "Issue", repository: "gyuniverse-hq/app", number: 1, title: "Backlog work", url: "https://example/1", state: "OPEN", merged: null, assignees: [], fields: { Status: "Backlog", Priority: "P1" } },
      { itemId: "I2", contentId: "C2", contentType: "Issue", repository: "gyuniverse-hq/app", number: 2, title: "Active work", url: "https://example/2", state: "OPEN", merged: null, assignees: ["4hglee-ops"], fields: { Status: "In Progress", Priority: "P0" } },
      { itemId: "I3", contentId: "C3", contentType: "PullRequest", repository: "gyuniverse-hq/app", number: 3, title: "Review work", url: "https://example/3", state: "OPEN", merged: false, assignees: ["reviewer"], fields: { Status: "In Review", Priority: "P1" } },
      { itemId: "I4", contentId: "C4", contentType: "Issue", repository: "gyuniverse-hq/app", number: 4, title: "Blocked work", url: "https://example/4", state: "OPEN", merged: null, assignees: ["4hglee-ops"], fields: { Status: "Todo", Priority: "P2", "Blocked Reason": "Waiting for API approval" } },
      { itemId: "I5", contentId: "C5", contentType: "Issue", repository: "gyuniverse-hq/app", number: 5, title: "Done work", url: "https://example/5", state: "CLOSED", merged: null, assignees: [], fields: { Status: "Done", Priority: "P2" } },
    ],
  };
  return new HighLevelReadService(new SnapshotService(new StubSnapshotReader(snapshot)));
}

test("getProjectBrief summarizes workflow state without inferring completion", async () => {
  const result = await service().getProjectBrief("gyuniverse-hq", 2);
  assert.equal(result.summary.visibleItems, 5);
  assert.equal(result.summary.doneItems, 1);
  assert.equal(result.summary.reviewQueueItems, 1);
  assert.equal(result.summary.unassignedOpenItems, 1);
  assert.equal(result.summary.explicitBlockers, 1);
  assert.equal(result.summary.byStatus.Backlog, 1);
});

test("getMyWork requires explicit login before M7 identity exists", async () => {
  const reads = service();
  await assert.rejects(() => reads.getMyWork("gyuniverse-hq", 2, { login: "" }), /login is required/);
  const result = await reads.getMyWork("gyuniverse-hq", 2, { login: "4hglee-ops" });
  assert.deepEqual(result.items.map((item) => item.itemId), ["I2", "I4"]);
});

test("backlog, review, and unassigned filters use explicit Project state", async () => {
  const reads = service();
  assert.deepEqual((await reads.getBacklog("gyuniverse-hq", 2)).items.map((item) => item.itemId), ["I1"]);
  assert.deepEqual((await reads.getReviewQueue("gyuniverse-hq", 2)).items.map((item) => item.itemId), ["I3"]);
  assert.deepEqual((await reads.getUnassignedWork("gyuniverse-hq", 2)).items.map((item) => item.itemId), ["I1"]);
});

test("getBlockers reports only explicit blocker evidence", async () => {
  const result = await service().getBlockers("gyuniverse-hq", 2);
  assert.equal(result.count, 1);
  assert.equal(result.blockers[0]?.item.itemId, "I4");
  assert.match(result.blockers[0]?.reason ?? "", /Waiting for API approval/);
});
