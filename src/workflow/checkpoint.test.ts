import assert from "node:assert/strict";
import test from "node:test";

import {
  compareProjectStateCheckpoint,
  createProjectStateCheckpoint,
  ProjectCheckpointStore,
} from "./checkpoint.js";

function checkpoint(
  items: Parameters<typeof createProjectStateCheckpoint>[0]["items"],
  requestedItems = 100,
  createdAt = "2026-09-05T00:00:00.000Z",
) {
  return createProjectStateCheckpoint(
    {
      snapshotAt: createdAt,
      owner: "gyuniverse-hq",
      project: { id: "PVT_1", number: 2, title: "LOV WBS", url: "https://github.com/users/gyuniverse-hq/projects/2" },
      items,
    },
    { owner: "gyuniverse-hq", projectNumber: 2, requestedItems, createdAt },
  );
}

test("detects workflow, repository, merge, assignee, and custom field changes", () => {
  const baseline = checkpoint([
    {
      itemId: "PVTI_1",
      contentId: "PR_1",
      contentType: "PullRequest",
      repository: "gyuniverse-hq/backend",
      number: 7,
      title: "Add endpoint",
      url: "https://github.com/gyuniverse-hq/backend/pull/7",
      state: "OPEN",
      merged: false,
      assignees: ["dev-b"],
      fields: { Status: "In Review", Priority: "P1", Labels: ["api", "backend"] },
    },
  ]);
  const current = checkpoint([
    {
      itemId: "PVTI_1",
      contentId: "PR_1",
      contentType: "PullRequest",
      repository: "gyuniverse-hq/backend",
      number: 7,
      title: "Add endpoint",
      url: "https://github.com/gyuniverse-hq/backend/pull/7",
      state: "CLOSED",
      merged: true,
      assignees: ["dev-a", "dev-b"],
      fields: { Status: "Done", Priority: "P0", Labels: ["backend", "release"] },
    },
  ], 100, "2026-09-05T01:00:00.000Z");

  const result = compareProjectStateCheckpoint(baseline, current);

  assert.equal(result.hasChanges, true);
  assert.equal(result.summary.statusChangedCount, 1);
  assert.equal(result.summary.priorityChangedCount, 1);
  assert.equal(result.summary.assigneesChangedCount, 1);
  assert.equal(result.summary.repositoryStateChangedCount, 1);
  assert.equal(result.summary.mergedChangedCount, 1);
  assert.equal(result.summary.fieldChangedCount, 1);
  assert.equal(result.summary.deltaCount, 6);
});

test("normalizes unordered assignee and multi-value fields to avoid noisy deltas", () => {
  const baseline = checkpoint([
    { itemId: "PVTI_1", assignees: ["dev-b", "dev-a"], fields: { Labels: ["api", "backend"] } },
  ]);
  const current = checkpoint([
    { itemId: "PVTI_1", assignees: ["dev-a", "dev-b"], fields: { Labels: ["backend", "api"] } },
  ]);

  const result = compareProjectStateCheckpoint(baseline, current);
  assert.equal(result.hasChanges, false);
  assert.equal(result.summary.deltaCount, 0);
});

test("reports snapshot membership changes and marks them non-authoritative at the item limit", () => {
  const baseline = checkpoint([{ itemId: "PVTI_old" }], 1);
  const current = checkpoint([{ itemId: "PVTI_new" }], 1, "2026-09-05T01:00:00.000Z");

  const result = compareProjectStateCheckpoint(baseline, current);

  assert.equal(result.summary.enteredSnapshotCount, 1);
  assert.equal(result.summary.leftSnapshotCount, 1);
  assert.equal(result.coverage.membershipChangesAuthoritative, false);
  assert.match(result.coverage.note, /snapshot-window observations/);
});

test("treats membership changes as authoritative when both captures return fewer items than requested", () => {
  const baseline = checkpoint([{ itemId: "PVTI_old" }], 100);
  const current = checkpoint([], 100, "2026-09-05T01:00:00.000Z");

  const result = compareProjectStateCheckpoint(baseline, current);
  assert.equal(result.summary.leftSnapshotCount, 1);
  assert.equal(result.coverage.membershipChangesAuthoritative, true);
});

test("rejects cross-project comparisons", () => {
  const baseline = checkpoint([{ itemId: "PVTI_1" }]);
  const current = createProjectStateCheckpoint(
    { project: { id: "PVT_2" }, items: [{ itemId: "PVTI_1" }] },
    { owner: "gyuniverse-hq", projectNumber: 3, requestedItems: 100 },
  );

  assert.throws(() => compareProjectStateCheckpoint(baseline, current), /different GitHub Projects/);
});

test("stores only the latest process-local checkpoint per owner and project", () => {
  const store = new ProjectCheckpointStore();
  const first = checkpoint([{ itemId: "PVTI_1", fields: { Status: "Todo" } }]);
  const second = checkpoint([{ itemId: "PVTI_1", fields: { Status: "Done" } }], 100, "2026-09-05T02:00:00.000Z");

  store.set(first);
  assert.equal(store.get("GYUNIVERSE-HQ", 2)?.createdAt, first.createdAt);
  store.set(second);
  assert.equal(store.get("gyuniverse-hq", 2)?.createdAt, second.createdAt);
  assert.equal(store.get("gyuniverse-hq", 3), undefined);
});
