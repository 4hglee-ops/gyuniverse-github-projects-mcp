import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { WorkItemService } from "./work-item-service.js";

class StubGraphQlClient extends GitHubGraphQlClient {
  constructor(private readonly handler: (query: string, variables: Record<string, unknown>) => unknown) {
    super("test-token");
  }

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.handler(query, variables) as T;
  }
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    githubToken: "test-token",
    allowedOwners: ["gyuniverse-hq"],
    allowedProjectIds: ["PVT_allowed"],
    writeEnabled: true,
    ...overrides,
  };
}

test("resolveWorkItemUrl enforces repository owner allowlist", async () => {
  const client = new StubGraphQlClient(() => ({
    repository: {
      issue: {
        id: "I_1",
        number: 1,
        title: "Issue",
        url: "https://github.com/gyuniverse-hq/repo/issues/1",
        state: "OPEN",
        repository: { nameWithOwner: "gyuniverse-hq/repo" },
      },
    },
  }));
  const service = new WorkItemService({
    config: config(),
    client,
    projects: { resolveProject: async () => ({ id: "PVT_allowed" }) },
  });

  const resolved = await service.resolveWorkItemUrl("https://github.com/gyuniverse-hq/repo/issues/1");
  assert.equal(resolved.contentId, "I_1");
  await assert.rejects(
    () => service.resolveWorkItemUrl("https://github.com/other-org/repo/issues/1"),
    /owner is not allowed/,
  );
});

test("resolveProjectItem validates Project access and scans membership", async () => {
  let projectResolved = false;
  const client = new StubGraphQlClient((query) => {
    if (query.includes("issue(number:")) {
      return {
        repository: {
          issue: {
            id: "I_1",
            number: 1,
            title: "Issue",
            url: "https://github.com/gyuniverse-hq/repo/issues/1",
            state: "OPEN",
            repository: { nameWithOwner: "gyuniverse-hq/repo" },
          },
        },
      };
    }

    return {
      repositoryOwner: {
        projectV2: {
          id: "PVT_allowed",
          number: 2,
          title: "Project",
          items: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              id: "PVTI_1",
              type: "ISSUE",
              isArchived: false,
              content: {
                __typename: "Issue",
                id: "I_1",
                number: 1,
                title: "Issue",
                url: "https://github.com/gyuniverse-hq/repo/issues/1",
                repository: { nameWithOwner: "gyuniverse-hq/repo" },
              },
            }],
          },
        },
      },
    };
  });
  const service = new WorkItemService({
    config: config(),
    client,
    projects: {
      resolveProject: async () => {
        projectResolved = true;
        return { id: "PVT_allowed" };
      },
    },
  });

  const result = await service.resolveProjectItem(
    "gyuniverse-hq",
    2,
    "https://github.com/gyuniverse-hq/repo/issues/1",
  );
  assert.equal(projectResolved, true);
  assert.equal(result.projectItem.found, true);
  assert.equal(result.projectItem.item?.itemId, "PVTI_1");
});
