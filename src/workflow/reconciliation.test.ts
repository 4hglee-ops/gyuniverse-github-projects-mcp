import assert from "node:assert/strict";
import test from "node:test";

import { analyzeProjectReconciliation } from "./reconciliation.js";

test("detects merged PR whose Project status is not completed", () => {
  const analysis = analyzeProjectReconciliation({
    owner: "gyuniverse-hq",
    items: [
      {
        itemId: "PVTI_1",
        contentId: "PR_1",
        contentType: "PullRequest",
        repository: "gyuniverse-hq/backend",
        number: 42,
        title: "Merge endpoint",
        url: "https://github.com/gyuniverse-hq/backend/pull/42",
        state: "MERGED",
        merged: true,
        fields: { Status: "In Review" },
      },
    ],
  });

  assert.equal(analysis.summary.analyzedPullRequests, 1);
  assert.equal(analysis.summary.mismatchCount, 1);
  assert.equal(analysis.summary.mergedButNotDoneCount, 1);
  assert.equal(analysis.mismatches[0]?.kind, "merged_pr_not_done");
  assert.equal(analysis.mismatches[0]?.evidence.number, 42);
  assert.equal(analysis.mismatches[0]?.evidence.projectStatus, "In Review");
});

test("detects Project Done when PR is not merged", () => {
  const analysis = analyzeProjectReconciliation({
    items: [
      {
        itemId: "PVTI_2",
        contentType: "PullRequest",
        state: "OPEN",
        merged: false,
        fields: { Status: "Done" },
      },
    ],
  });

  assert.equal(analysis.summary.doneButNotMergedCount, 1);
  assert.equal(analysis.mismatches[0]?.kind, "done_pr_not_merged");
});

test("treats merged + Done and open + In Progress as aligned", () => {
  const analysis = analyzeProjectReconciliation({
    items: [
      {
        itemId: "PVTI_merged_done",
        contentType: "PullRequest",
        merged: true,
        fields: { Status: "Done" },
      },
      {
        itemId: "PVTI_open_progress",
        contentType: "PullRequest",
        merged: false,
        fields: { Status: "In Progress" },
      },
      {
        itemId: "PVTI_issue",
        contentType: "Issue",
        fields: { Status: "Done" },
      },
    ],
  });

  assert.equal(analysis.summary.analyzedPullRequests, 2);
  assert.equal(analysis.summary.alignedCount, 2);
  assert.equal(analysis.summary.ignoredNonPullRequestItems, 1);
  assert.equal(analysis.summary.mismatchCount, 0);
});

test("supports custom completed status names and disabling reverse mismatch", () => {
  const analysis = analyzeProjectReconciliation(
    {
      items: [
        {
          itemId: "PVTI_custom",
          contentType: "PullRequest",
          merged: true,
          fields: { Workflow: "Shipped" },
        },
        {
          itemId: "PVTI_reverse",
          contentType: "PullRequest",
          merged: false,
          fields: { Workflow: "Shipped" },
        },
      ],
    },
    {
      statusFieldName: "Workflow",
      completedStatusNames: ["Shipped"],
      reportDoneButNotMerged: false,
    },
  );

  assert.equal(analysis.summary.mismatchCount, 0);
  assert.equal(analysis.summary.alignedCount, 2);
});
