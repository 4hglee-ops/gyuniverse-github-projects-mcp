import assert from "node:assert/strict";
import test from "node:test";

import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { updateProjectSingleSelectByName } from "./single-select-update.js";

interface ClientOptions {
  fieldType?: string;
  options?: Array<{ id: string; name: string }>;
  beforeProjectId?: string;
  beforeOption?: { id: string; name: string } | null;
  afterOption?: { id: string; name: string } | null;
}

class UpdateClient extends GitHubGraphQlClient {
  mutationCount = 0;
  requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  private nodeReads = 0;
  private readonly options: Required<ClientOptions>;

  constructor(options: ClientOptions = {}) {
    super("test-token");
    this.options = {
      fieldType: options.fieldType ?? "ProjectV2SingleSelectField",
      options: options.options ?? [
        { id: "OPT_TODO", name: "Todo" },
        { id: "OPT_PROGRESS", name: "In Progress" },
      ],
      beforeProjectId: options.beforeProjectId ?? "PVT_PROJECT",
      beforeOption: options.beforeOption === undefined ? { id: "OPT_TODO", name: "Todo" } : options.beforeOption,
      afterOption: options.afterOption === undefined ? { id: "OPT_PROGRESS", name: "In Progress" } : options.afterOption,
    };
  }

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ query, variables });

    if (query.includes("fields(first: 100)")) {
      return {
        repositoryOwner: {
          projectV2: {
            fields: {
              nodes: [
                {
                  __typename: this.options.fieldType,
                  id: "FIELD_STATUS",
                  name: "Status",
                  dataType: "SINGLE_SELECT",
                  options: this.options.options,
                },
              ],
            },
          },
        },
      } as T;
    }

    if (query.includes("node(id: $itemId)")) {
      const selected = this.nodeReads++ === 0 ? this.options.beforeOption : this.options.afterOption;
      return {
        node: {
          __typename: "ProjectV2Item",
          id: variables.itemId,
          project: {
            id: this.options.beforeProjectId,
            number: 2,
            title: "LOV WBS",
          },
          fieldValueByName: selected
            ? {
                __typename: "ProjectV2ItemFieldSingleSelectValue",
                optionId: selected.id,
                name: selected.name,
              }
            : null,
        },
      } as T;
    }

    if (query.includes("updateProjectV2ItemFieldValue")) {
      this.mutationCount += 1;
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.itemId } } } as T;
    }

    throw new Error("Unexpected query in test client.");
  }
}

const input = {
  owner: "gyuniverse-hq",
  projectNumber: 2,
  projectId: "PVT_PROJECT",
  itemId: "PVTI_ITEM",
  fieldName: "Status",
  optionName: "In Progress",
};

test("resolves an exact single-select option, mutates once, and verifies by re-reading", async () => {
  const client = new UpdateClient();

  const result = await updateProjectSingleSelectByName(client, input);

  assert.equal(client.mutationCount, 1);
  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.deepEqual(result.before, { id: "OPT_TODO", name: "Todo" });
  assert.deepEqual(result.after, { id: "OPT_PROGRESS", name: "In Progress" });

  const mutation = client.requests.find((request) => request.query.includes("updateProjectV2ItemFieldValue"));
  assert.deepEqual(mutation?.variables, {
    projectId: "PVT_PROJECT",
    itemId: "PVTI_ITEM",
    fieldId: "FIELD_STATUS",
    value: { singleSelectOptionId: "OPT_PROGRESS" },
  });
});

test("skips a mutation when the item is already at the requested option", async () => {
  const client = new UpdateClient({
    beforeOption: { id: "OPT_PROGRESS", name: "In Progress" },
  });

  const result = await updateProjectSingleSelectByName(client, input);

  assert.equal(client.mutationCount, 0);
  assert.equal(result.changed, false);
  assert.equal(result.verified, true);
  assert.equal(result.mutationSkippedReason, "already_at_requested_option");
});

test("rejects an item that belongs to a different Project before mutation", async () => {
  const client = new UpdateClient({ beforeProjectId: "PVT_OTHER" });

  await assert.rejects(
    () => updateProjectSingleSelectByName(client, input),
    /PROJECT_ITEM_PROJECT_MISMATCH/,
  );
  assert.equal(client.mutationCount, 0);
});

test("rejects a non-single-select field and an unknown option before mutation", async () => {
  const invalidFieldClient = new UpdateClient({ fieldType: "ProjectV2Field" });
  await assert.rejects(
    () => updateProjectSingleSelectByName(invalidFieldClient, input),
    /INVALID_FIELD_TYPE/,
  );
  assert.equal(invalidFieldClient.mutationCount, 0);

  const missingOptionClient = new UpdateClient({
    options: [{ id: "OPT_TODO", name: "Todo" }],
  });
  await assert.rejects(
    () => updateProjectSingleSelectByName(missingOptionClient, input),
    /PROJECT_FIELD_OPTION_NOT_FOUND/,
  );
  assert.equal(missingOptionClient.mutationCount, 0);
});

test("fails closed when post-mutation verification does not match the requested option", async () => {
  const client = new UpdateClient({
    afterOption: { id: "OPT_TODO", name: "Todo" },
  });

  await assert.rejects(
    () => updateProjectSingleSelectByName(client, input),
    /MUTATION_VERIFICATION_FAILED/,
  );
  assert.equal(client.mutationCount, 1);
});
