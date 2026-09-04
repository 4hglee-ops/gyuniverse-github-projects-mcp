import assert from "node:assert/strict";
import test from "node:test";

import { GitHubGraphQlClient } from "./graphql-client.js";
import { getProjectSnapshot, listProjectFields } from "./projects.js";

class SchemaCaptureClient extends GitHubGraphQlClient {
  query = "";

  constructor() {
    super("test-token");
  }

  override async request<T>(query: string): Promise<T> {
    this.query = query;
    return {
      repositoryOwner: { projectV2: { fields: { nodes: [] } } },
    } as T;
  }
}

test("field query uses current ProjectV2 field configuration types", async () => {
  const client = new SchemaCaptureClient();

  await listProjectFields(client, "gyuniverse-hq", 1);

  assert.match(client.query, /repositoryOwner\(login: \$login\)/);
  assert.doesNotMatch(client.query, /organization\(login: \$login\)/);
  assert.match(client.query, /ProjectV2MultiSelectField/);
  assert.match(client.query, /multiSelectOptions/);
  assert.doesNotMatch(client.query, /ProjectV2RepositoryField/);
});

class SnapshotClient extends GitHubGraphQlClient {
  constructor() {
    super("test-token");
  }

  override async request<T>(query: string): Promise<T> {
    if (query.includes("fields(first: 100)")) {
      return {
        repositoryOwner: { projectV2: { fields: { nodes: [] } } },
      } as T;
    }

    if (query.includes("items(first: $first)")) {
      return {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: "PVTI_item",
                  type: "ISSUE",
                  content: {
                    __typename: "Issue",
                    id: "I_issue",
                    number: 7,
                    title: "Test issue",
                    url: "https://github.com/gyuniverse-hq/example/issues/7",
                    state: "OPEN",
                    repository: { nameWithOwner: "gyuniverse-hq/example" },
                    assignees: { nodes: [{ login: "octocat" }] },
                  },
                  fieldValues: {
                    nodes: [
                      {
                        __typename: "ProjectV2ItemFieldMultiSelectValue",
                        options: [
                          { id: "option-1", name: "Backend" },
                          { id: "option-2", name: "Urgent" },
                        ],
                        field: { id: "field-1", name: "Tags" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      } as T;
    }

    return {
      repositoryOwner: { projectV2: { id: "PVT_project", number: 1, title: "Example" } },
    } as T;
  }
}

test("snapshot normalizes multi-select values and preserves evidence", async () => {
  const snapshot = await getProjectSnapshot(new SnapshotClient(), "gyuniverse-hq", 1) as {
    itemCount: number;
    items: Array<{
      repository: string;
      assignees: string[];
      fields: Record<string, unknown>;
    }>;
  };

  assert.equal(snapshot.itemCount, 1);
  assert.equal(snapshot.items[0]?.repository, "gyuniverse-hq/example");
  assert.deepEqual(snapshot.items[0]?.assignees, ["octocat"]);
  assert.deepEqual(snapshot.items[0]?.fields.Tags, ["Backend", "Urgent"]);
});
