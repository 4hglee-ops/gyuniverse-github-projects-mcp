import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubIssue } from "./create-work-item.js";
import type { GitHubGraphQlClient } from "../github/graphql-client.js";

test("createGitHubIssue resolves repository then returns complete created Issue", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      calls.push({ query, variables });
      if (query.includes("repository(owner:")) {
        return {
          repository: { id: "REPO_NODE", nameWithOwner: "gyuniverse-hq/bid-change-validator" },
        } as T;
      }
      return {
        createIssue: {
          issue: {
            id: "ISSUE_NODE",
            number: 42,
            title: "Created by semantic tool",
            url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/42",
            repository: { nameWithOwner: "gyuniverse-hq/bid-change-validator" },
          },
        },
      } as T;
    },
  } as GitHubGraphQlClient;

  const result = await createGitHubIssue(client, {
    owner: "gyuniverse-hq",
    repository: "bid-change-validator",
    title: "Created by semantic tool",
    body: "body",
  });

  assert.equal(result.id, "ISSUE_NODE");
  assert.equal(result.number, 42);
  assert.equal(result.repository, "gyuniverse-hq/bid-change-validator");
  assert.equal(calls.length, 2);
});
