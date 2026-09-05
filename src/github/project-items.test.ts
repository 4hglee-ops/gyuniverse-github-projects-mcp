import assert from "node:assert/strict";
import test from "node:test";

import { GitHubGraphQlClient } from "./graphql-client.js";
import { findProjectItemByContentId } from "./project-items.js";

class PaginatedProjectClient extends GitHubGraphQlClient {
  calls = 0;

  constructor() {
    super("test-token");
  }

  override async request<T>(_query: string, variables: Record<string, unknown>): Promise<T> {
    this.calls += 1;
    const after = variables.after as string | null;

    if (!after) {
      return {
        repositoryOwner: {
          projectV2: {
            id: "PVT_project",
            number: 2,
            title: "LOV WBS",
            items: {
              totalCount: 101,
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
              nodes: [
                {
                  id: "PVTI_first",
                  type: "ISSUE",
                  isArchived: false,
                  content: {
                    __typename: "Issue",
                    id: "I_other",
                    number: 1,
                    title: "Other",
                    url: "https://github.com/gyuniverse-hq/example/issues/1",
                    repository: { nameWithOwner: "gyuniverse-hq/example" },
                  },
                },
              ],
            },
          },
        },
      } as T;
    }

    return {
      repositoryOwner: {
        projectV2: {
          id: "PVT_project",
          number: 2,
          title: "LOV WBS",
          items: {
            totalCount: 101,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "PVTI_target",
                type: "PULL_REQUEST",
                isArchived: false,
                content: {
                  __typename: "PullRequest",
                  id: "PR_target",
                  number: 7,
                  title: "Target",
                  url: "https://github.com/gyuniverse-hq/example/pull/7",
                  repository: { nameWithOwner: "gyuniverse-hq/example" },
                },
              },
            ],
          },
        },
      },
    } as T;
  }
}

test("findProjectItemByContentId follows pagination and resolves the Project item", async () => {
  const client = new PaginatedProjectClient();
  const result = await findProjectItemByContentId(client, "gyuniverse-hq", 2, "PR_target");

  assert.equal(client.calls, 2);
  assert.equal(result.found, true);
  assert.equal(result.item?.itemId, "PVTI_target");
  assert.equal(result.item?.contentType, "PullRequest");
  assert.equal(result.project.title, "LOV WBS");
  assert.equal(result.searchExhaustive, true);
});

class MissingProjectItemClient extends GitHubGraphQlClient {
  constructor() {
    super("test-token");
  }

  override async request<T>(): Promise<T> {
    return {
      repositoryOwner: {
        projectV2: {
          id: "PVT_project",
          number: 2,
          title: "LOV WBS",
          items: {
            totalCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      },
    } as T;
  }
}

test("findProjectItemByContentId reports an exhaustive miss", async () => {
  const result = await findProjectItemByContentId(
    new MissingProjectItemClient(),
    "gyuniverse-hq",
    2,
    "I_missing",
  );

  assert.equal(result.found, false);
  assert.equal(result.item, null);
  assert.equal(result.searchExhaustive, true);
  assert.equal(result.pagesScanned, 1);
});
