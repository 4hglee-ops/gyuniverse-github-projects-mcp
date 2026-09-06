import assert from "node:assert/strict";
import test from "node:test";

import { GitHubGraphQlClient } from "./graphql-client.js";
import { readProjectItemReferenceInventory } from "./project-item-references.js";

function node(itemId: string, number: number) {
  return {
    id: itemId,
    type: "ISSUE",
    content: {
      __typename: "Issue",
      id: `CONTENT_${itemId}`,
      number,
      title: `Issue ${number}`,
      url: `https://github.com/gyuniverse-hq/repo/issues/${number}`,
      repository: { nameWithOwner: "gyuniverse-hq/repo" },
    },
  };
}

class InventoryClient extends GitHubGraphQlClient {
  calls: Array<Record<string, unknown>> = [];
  constructor(private readonly responses: unknown[]) { super("test-token-never-log"); }
  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    assert.match(query, /query ProjectItemReferenceInventory/);
    this.calls.push(variables);
    const response = this.responses.shift();
    if (!response) throw new Error("Missing inventory response.");
    return response as T;
  }
}

function page(nodes: unknown[], hasNextPage: boolean, endCursor: string | null, projectId = "PVT") {
  return { node: { __typename: "ProjectV2", id: projectId,
    items: { nodes, pageInfo: { hasNextPage, endCursor } } } };
}

test("Project item reference inventory paginates only by authorized Project ID", async () => {
  const client = new InventoryClient([
    page([node("PVTI_8", 8)], true, "CURSOR_1"),
    page([node("PVTI_9", 9)], false, null),
  ]);
  const result = await readProjectItemReferenceInventory(client, "PVT");
  assert.deepEqual(result.items.map((item) => item.id), ["PVTI_8", "PVTI_9"]);
  assert.deepEqual(result.coverage, {
    pagesScanned: 2, scannedItems: 2, inaccessibleItems: 0,
    hasNextPage: false, complete: true, maxItems: 1000,
  });
  assert.deepEqual(client.calls, [
    { projectId: "PVT", after: null },
    { projectId: "PVT", after: "CURSOR_1" },
  ]);
  assert.equal(client.calls.some((call) => "login" in call || "repository" in call), false);
});

test("Project item reference inventory marks the ten-page bound incomplete", async () => {
  const responses = Array.from({ length: 10 }, (_, index) =>
    page([node(`PVTI_${index}`, index + 1)], true, `CURSOR_${index + 1}`));
  const result = await readProjectItemReferenceInventory(new InventoryClient(responses), "PVT");
  assert.equal(result.coverage.pagesScanned, 10);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.hasNextPage, true);
});

test("Project item reference inventory rejects wrong Projects, duplicates and invalid cursors", async () => {
  await assert.rejects(
    () => readProjectItemReferenceInventory(new InventoryClient([page([], false, null, "OTHER")]), "PVT"),
    /PROJECT_ITEM_REFERENCE_RESPONSE_INVALID/,
  );
  await assert.rejects(
    () => readProjectItemReferenceInventory(new InventoryClient([page([node("PVTI_8", 8), node("PVTI_8", 8)], false, null)]), "PVT"),
    /PROJECT_ITEM_REFERENCE_RESPONSE_INVALID/,
  );
  await assert.rejects(
    () => readProjectItemReferenceInventory(new InventoryClient([page([node("PVTI_8", 8)], true, null)]), "PVT"),
    /PROJECT_ITEM_REFERENCE_RESPONSE_INVALID/,
  );
});
