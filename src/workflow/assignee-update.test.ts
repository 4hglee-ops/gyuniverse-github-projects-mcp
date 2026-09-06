import assert from "node:assert/strict";
import test from "node:test";

import type { GitHubGraphQlClient } from "../github/graphql-client.js";
import { assignProjectWorkItem } from "./assignee-update.js";

function clientFrom(responses: unknown[], queries: string[]): GitHubGraphQlClient {
  return {
    async request(query: string) {
      queries.push(query);
      if (responses.length === 0) throw new Error("Unexpected GraphQL request");
      return responses.shift();
    },
  } as unknown as GitHubGraphQlClient;
}

const user = { user: { id: "USER_NODE", login: "4hglee-ops" } };

function item(assignees: Array<{ id: string; login: string }>, projectId = "PVT_PROJECT") {
  return {
    node: {
      __typename: "ProjectV2Item",
      id: "PVTI_ITEM",
      project: { id: projectId, number: 2, title: "Bid Change Validator · WBS" },
      content: {
        __typename: "Issue",
        id: "ISSUE_NODE",
        assignees: { nodes: assignees },
      },
    },
  };
}

test("assignment skips mutation when requested login is already assigned", async () => {
  const queries: string[] = [];
  const client = clientFrom([
    user,
    item([{ id: "USER_NODE", login: "4hglee-ops" }]),
  ], queries);

  const result = await assignProjectWorkItem(client, {
    projectId: "PVT_PROJECT",
    itemId: "PVTI_ITEM",
    assigneeLogin: "4hglee-ops",
  });

  assert.equal(result.changed, false);
  assert.equal(result.verified, true);
  assert.equal(result.mutationSkippedReason, "already_assigned");
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => !query.includes("addAssigneesToAssignable")));
});

test("assignment mutates once and verifies the requested login", async () => {
  const queries: string[] = [];
  const client = clientFrom([
    user,
    item([]),
    { addAssigneesToAssignable: { assignable: { id: "ISSUE_NODE" } } },
    item([{ id: "USER_NODE", login: "4hglee-ops" }]),
  ], queries);

  const result = await assignProjectWorkItem(client, {
    projectId: "PVT_PROJECT",
    itemId: "PVTI_ITEM",
    assigneeLogin: "4hglee-ops",
  });

  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.equal(result.after[0]?.login, "4hglee-ops");
  assert.equal(queries.filter((query) => query.includes("addAssigneesToAssignable")).length, 1);
});

test("assignment rejects a Project item from another Project before mutation", async () => {
  const queries: string[] = [];
  const client = clientFrom([
    user,
    item([], "PVT_OTHER"),
  ], queries);

  await assert.rejects(
    assignProjectWorkItem(client, {
      projectId: "PVT_PROJECT",
      itemId: "PVTI_ITEM",
      assigneeLogin: "4hglee-ops",
    }),
    /PROJECT_ITEM_PROJECT_MISMATCH/,
  );
  assert.equal(queries.filter((query) => query.includes("addAssigneesToAssignable")).length, 0);
});
