import assert from "node:assert/strict";
import test from "node:test";

import { SnapshotService } from "../snapshots/snapshot-service.js";
import { WorkflowService } from "./workflow-service.js";

function serviceWith(items: unknown[]) {
  const snapshots = new SnapshotService({
    async getProjectSnapshot(owner) {
      return {
        snapshotAt: "2026-09-05T00:00:00.000Z",
        owner,
        itemCount: items.length,
        items,
      };
    },
  });
  return new WorkflowService(snapshots);
}

test("WorkflowService owns state-gap analysis over shared snapshots", async () => {
  const service = serviceWith([
    {
      itemId: "PVTI_1",
      contentType: "Issue",
      title: "Unassigned",
      state: "OPEN",
      assignees: [],
      fields: {},
    },
  ]);

  const result = await service.analyzeStateGaps("gyuniverse-hq", 2, 100);
  assert.equal(result.summary.missingStatusCount, 1);
  assert.equal(result.summary.missingAssigneeCount, 1);
  assert.equal(result.coverage.returnedItems, 1);
});

test("WorkflowService owns reconciliation analysis over shared snapshots", async () => {
  const service = serviceWith([
    {
      itemId: "PVTI_2",
      contentType: "PullRequest",
      title: "Merged PR",
      state: "CLOSED",
      merged: true,
      assignees: ["dev"],
      fields: { Status: "In Review" },
    },
  ]);

  const result = await service.analyzeReconciliation("gyuniverse-hq", 2, 100);
  assert.equal(result.summary.mergedButNotDoneCount, 1);
  assert.equal(result.summary.mismatchCount, 1);
});

test("WorkflowService returns the shared brief contract", async () => {
  const service = serviceWith([]);
  const result = await service.getBriefContext("gyuniverse-hq", 2, 100);
  assert.ok(result.contract.sections.includes("State Gaps"));
  assert.ok(result.contract.rules.some((rule) => rule.includes("Do not infer Done")));
});
