import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import type { ProjectItemReferenceInventory } from "../../github/project-item-references.js";
import { AuthorizedProjectItemReferenceResolver } from "./project-item-reference-resolver.js";

const baseConfig: AppConfig = {
  githubToken: "test-token-never-log",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT"],
  writeEnabled: true,
};

function issue(itemId: string, repository: string, number: number, type: "Issue" | "PullRequest" = "Issue") {
  const segment = type === "Issue" ? "issues" : "pull";
  return {
    id: itemId,
    type: type.toUpperCase(),
    content: {
      __typename: type,
      id: `CONTENT_${itemId}`,
      number,
      title: `${type} ${number}`,
      url: `https://github.com/${repository}/${segment}/${number}`,
      repository: { nameWithOwner: repository },
    },
  } as const;
}

function inventory(items: ProjectItemReferenceInventory["items"], overrides: Partial<ProjectItemReferenceInventory["coverage"]> = {}): ProjectItemReferenceInventory {
  return {
    items,
    coverage: {
      pagesScanned: 1,
      scannedItems: items.length,
      inaccessibleItems: items.filter((item) => item.content === null).length,
      hasNextPage: false,
      complete: true,
      maxItems: 1000,
      ...overrides,
    },
  };
}

function fixture(items: ProjectItemReferenceInventory["items"], config = baseConfig,
  coverage: Partial<ProjectItemReferenceInventory["coverage"]> = {}) {
  const projectCalls: Array<{ owner: string; number: number }> = [];
  const inventoryProjectIds: string[] = [];
  const resolver = new AuthorizedProjectItemReferenceResolver({
    config,
    client: new GitHubGraphQlClient(config.githubToken),
    projects: { async resolveProject(owner, number) {
      projectCalls.push({ owner, number });
      return { id: "PVT" };
    } },
    inventory: async (_client, projectId) => {
      inventoryProjectIds.push(projectId);
      return inventory(items, coverage);
    },
  });
  return { resolver, projectCalls, inventoryProjectIds };
}

test("authorized Project item resolver keeps exact itemId compatibility and confirms Project membership", async () => {
  const f = fixture([
    issue("PVTI_ONE", "gyuniverse-hq/repo", 8),
    { id: "PVTI_DRAFT", type: "DRAFT_ISSUE", content: null },
  ], baseConfig, { complete: false, hasNextPage: true, inaccessibleItems: 1 });
  const result = await f.resolver.resolveMany("gyuniverse-hq", 2, [{ itemId: "PVTI_DRAFT" }]);
  assert.equal(result.items[0]?.itemId, "PVTI_DRAFT");
  assert.deepEqual(f.projectCalls, [{ owner: "gyuniverse-hq", number: 2 }]);
  assert.deepEqual(f.inventoryProjectIds, ["PVT"]);

  await assert.rejects(
    () => f.resolver.resolveMany("gyuniverse-hq", 2, [{ itemId: "PVTI_OUTSIDE_PROJECT" }]),
    /PROJECT_ITEM_LOOKUP_INCOMPLETE/,
  );
});

test("authorized Project item resolver resolves Issue URL and repository plus number inside the Project", async () => {
  const f = fixture([
    issue("PVTI_8", "gyuniverse-hq/repo", 8),
    issue("PVTI_9", "gyuniverse-hq/repo", 9, "PullRequest"),
  ]);
  const result = await f.resolver.resolveMany("gyuniverse-hq", 2, [
    { url: "https://github.com/gyuniverse-hq/repo/issues/8" },
    { repository: "GYUNIVERSE-HQ/REPO", number: 9 },
  ]);
  assert.deepEqual(result.items.map((item) => item.itemId), ["PVTI_8", "PVTI_9"]);
});

test("authorized Project item resolver accepts a number only when unique across the Project", async () => {
  const unique = fixture([issue("PVTI_8", "gyuniverse-hq/repo", 8), issue("PVTI_9", "other/repo", 9)]);
  assert.equal((await unique.resolver.resolveMany(undefined, 2, [{ number: 8 }])).items[0]?.itemId, "PVTI_8");

  const duplicate = fixture([issue("PVTI_A", "gyuniverse-hq/alpha", 8), issue("PVTI_B", "gyuniverse-hq/beta", 8)]);
  await assert.rejects(
    () => duplicate.resolver.resolveMany("gyuniverse-hq", 2, [{ number: 8 }]),
    /PROJECT_ITEM_REFERENCE_AMBIGUOUS/,
  );
});

test("authorized Project item resolver returns stable not-found for unknown and outside-Project references", async () => {
  const f = fixture([issue("PVTI_8", "gyuniverse-hq/repo", 8)]);
  for (const reference of [
    { number: 99 },
    { repository: "gyuniverse-hq/other", number: 8 },
    { url: "https://github.com/gyuniverse-hq/other/issues/8" },
    { itemId: "PVTI_OUTSIDE" },
  ]) {
    await assert.rejects(
      () => f.resolver.resolveMany("gyuniverse-hq", 2, [reference]),
      /PROJECT_ITEM_NOT_FOUND/,
    );
  }
});

test("authorized Project item resolver rejects invalid forms and incomplete friendly-reference coverage", async () => {
  const complete = fixture([issue("PVTI_8", "gyuniverse-hq/repo", 8)]);
  for (const reference of [
    {},
    { itemId: "PVTI_8", number: 8 },
    { repository: "gyuniverse-hq/repo" },
    { url: "https://example.com/gyuniverse-hq/repo/issues/8" },
  ]) {
    await assert.rejects(
      () => complete.resolver.resolveMany("gyuniverse-hq", 2, [reference]),
      /PROJECT_ITEM_REFERENCE_INVALID/,
    );
  }

  const incomplete = fixture([issue("PVTI_8", "gyuniverse-hq/repo", 8)], baseConfig,
    { complete: false, hasNextPage: true });
  await assert.rejects(
    () => incomplete.resolver.resolveMany("gyuniverse-hq", 2, [{ number: 8 }]),
    /PROJECT_ITEM_LOOKUP_INCOMPLETE/,
  );
});

test("missing owner uses only one configured owner and otherwise fails closed", async () => {
  const one = fixture([issue("PVTI_8", "gyuniverse-hq/repo", 8)]);
  const resolved = await one.resolver.resolveMany(undefined, 2, [{ number: 8 }]);
  assert.equal(resolved.owner, "gyuniverse-hq");
  assert.deepEqual(one.projectCalls, [{ owner: "gyuniverse-hq", number: 2 }]);

  for (const allowedOwners of [[], ["gyuniverse-hq", "another-owner"]]) {
    const ambiguous = fixture([issue("PVTI_8", "gyuniverse-hq/repo", 8)], { ...baseConfig, allowedOwners });
    await assert.rejects(
      () => ambiguous.resolver.resolveMany(undefined, 2, [{ number: 8 }]),
      /PROJECT_OWNER_REQUIRED/,
    );
    assert.equal(ambiguous.projectCalls.length, 0);
  }
});
