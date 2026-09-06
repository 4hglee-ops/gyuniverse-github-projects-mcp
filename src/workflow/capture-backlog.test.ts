import assert from "node:assert/strict";
import test from "node:test";

import type { GitHubGraphQlClient } from "../github/graphql-client.js";
import { captureProjectBacklogItem, type CaptureBacklogWorkItemReader } from "./capture-backlog.js";

function resolution(found: boolean, itemId: string | null) {
  return {
    resolvedContent: {
      contentId: "ISSUE_NODE",
      title: "Test issue",
      url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/99",
      repositoryWithOwner: "gyuniverse-hq/bid-change-validator",
    },
    projectItem: {
      project: { id: "PVT_PROJECT", number: 2, title: "Bid Change Validator · WBS" },
      contentId: "ISSUE_NODE",
      found,
      item: itemId ? {
        itemId,
        itemType: "ISSUE",
        archived: false,
        contentType: "Issue",
        repository: "gyuniverse-hq/bid-change-validator",
        number: 99,
        title: "Test issue",
        url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/99",
      } : null,
      totalProjectItems: 1,
      scannedItems: 1,
      pagesScanned: 1,
      searchExhaustive: true,
    },
  };
}

function status(itemId: string, changed: boolean) {
  return {
    changed,
    verified: true,
    project: { id: "PVT_PROJECT", number: 2, title: "Bid Change Validator · WBS" },
    itemId,
    field: { id: "STATUS_FIELD", name: "Status" },
    requestedOption: { id: "BACKLOG", name: "Backlog" },
    before: changed ? { id: "TODO", name: "Todo" } : { id: "BACKLOG", name: "Backlog" },
    after: { id: "BACKLOG", name: "Backlog" },
    mutationSkippedReason: changed ? null : "already_at_requested_option",
  };
}

test("capture backlog uses the add mutation item ID and verifies Backlog without a stale list re-read", async () => {
  let reads = 0;
  let adds = 0;
  const updatedItemIds: string[] = [];
  const reader: CaptureBacklogWorkItemReader = {
    async resolveProjectItem() {
      reads += 1;
      return resolution(false, null);
    },
  };

  const result = await captureProjectBacklogItem(
    {} as GitHubGraphQlClient,
    reader,
    {
      owner: "gyuniverse-hq",
      projectNumber: 2,
      projectId: "PVT_PROJECT",
      url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/99",
    },
    {
      async addItem() { adds += 1; return { id: "PVTI_NEW" }; },
      async updateNamedSingleSelect(_client, input) {
        updatedItemIds.push(input.itemId);
        return status(input.itemId, true);
      },
    },
  );

  assert.equal(adds, 1);
  assert.equal(reads, 1);
  assert.deepEqual(updatedItemIds, ["PVTI_NEW"]);
  assert.equal(result.addedToProject, true);
  assert.equal(result.itemId, "PVTI_NEW");
  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.equal(result.status.after?.name, "Backlog");
});

test("capture backlog fails closed when add mutation does not return a Project item ID", async () => {
  const reader: CaptureBacklogWorkItemReader = {
    async resolveProjectItem() { return resolution(false, null); },
  };

  await assert.rejects(
    captureProjectBacklogItem(
      {} as GitHubGraphQlClient,
      reader,
      {
        owner: "gyuniverse-hq",
        projectNumber: 2,
        projectId: "PVT_PROJECT",
        url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/99",
      },
      {
        async addItem() { return {}; },
        async updateNamedSingleSelect(_client, input) { return status(input.itemId, true); },
      },
    ),
    /did not return a Project item ID/,
  );
});

test("capture backlog is no_change when item already exists in Backlog", async () => {
  let adds = 0;
  const reader: CaptureBacklogWorkItemReader = {
    async resolveProjectItem() { return resolution(true, "PVTI_EXISTING"); },
  };

  const result = await captureProjectBacklogItem(
    {} as GitHubGraphQlClient,
    reader,
    {
      owner: "gyuniverse-hq",
      projectNumber: 2,
      projectId: "PVT_PROJECT",
      url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/99",
    },
    {
      async addItem() { adds += 1; return {}; },
      async updateNamedSingleSelect(_client, input) { return status(input.itemId, false); },
    },
  );

  assert.equal(adds, 0);
  assert.equal(result.changed, false);
  assert.equal(result.mutationSkippedReason, "already_captured_in_backlog");
});
