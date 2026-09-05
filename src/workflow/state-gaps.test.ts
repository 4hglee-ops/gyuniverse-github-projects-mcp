import assert from "node:assert/strict";
import test from "node:test";

import { analyzeProjectStateGaps } from "./state-gaps.js";

test("detects missing Status and assignee while preserving evidence", () => {
  const analysis = analyzeProjectStateGaps({
    snapshotAt: "2026-09-05T00:00:00.000Z",
    owner: "gyuniverse-hq",
    items: [
      {
        itemId: "PVTI_1",
        contentId: "I_1",
        contentType: "Issue",
        repository: "gyuniverse-hq/backend",
        number: 12,
        title: "Implement endpoint",
        url: "https://github.com/gyuniverse-hq/backend/issues/12",
        state: "OPEN",
        assignees: [],
        fields: {},
      },
    ],
  });

  assert.equal(analysis.summary.analyzedItems, 1);
  assert.equal(analysis.summary.gapCount, 2);
  assert.equal(analysis.summary.itemsWithAnyGap, 1);
  assert.equal(analysis.summary.missingStatusCount, 1);
  assert.equal(analysis.summary.missingAssigneeCount, 1);
  assert.deepEqual(
    analysis.gaps.map((gap) => gap.kind).sort(),
    ["missing_assignee", "missing_status"],
  );
  assert.equal(analysis.gaps[0]?.evidence.repository, "gyuniverse-hq/backend");
  assert.equal(analysis.gaps[0]?.evidence.number, 12);
});

test("uses Project assignee fields and ignores completed work for missing-assignee by default", () => {
  const analysis = analyzeProjectStateGaps({
    items: [
      {
        itemId: "PVTI_project_assignee",
        state: "OPEN",
        assignees: [],
        fields: {
          Status: "In Progress",
          Assignees: ["octocat"],
        },
      },
      {
        itemId: "PVTI_done",
        state: "CLOSED",
        assignees: [],
        fields: { Status: "Done" },
      },
    ],
  });

  assert.equal(analysis.summary.gapCount, 0);
});

test("can include completed items in missing-assignee checks when requested", () => {
  const analysis = analyzeProjectStateGaps(
    {
      items: [
        {
          itemId: "PVTI_done",
          state: "CLOSED",
          assignees: [],
          fields: { Status: "Done" },
        },
      ],
    },
    { includeCompletedForAssignee: true },
  );

  assert.equal(analysis.summary.missingAssigneeCount, 1);
  assert.equal(analysis.gaps[0]?.kind, "missing_assignee");
});

test("excludes archived items by default and supports custom field names", () => {
  const analysis = analyzeProjectStateGaps(
    {
      items: [
        {
          itemId: "PVTI_archived",
          archived: true,
          fields: {},
        },
        {
          itemId: "PVTI_custom",
          state: "OPEN",
          fields: {
            Workflow: "Doing",
            Owner: ["dev-a"],
          },
        },
      ],
    },
    {
      statusFieldName: "Workflow",
      assigneeFieldNames: ["Owner"],
    },
  );

  assert.equal(analysis.summary.analyzedItems, 1);
  assert.equal(analysis.summary.gapCount, 0);
});
