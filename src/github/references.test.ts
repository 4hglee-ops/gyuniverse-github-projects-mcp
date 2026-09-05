import assert from "node:assert/strict";
import test from "node:test";

import { GitHubGraphQlClient } from "./graphql-client.js";
import {
  parseGitHubIssueOrPullRequestUrl,
  resolveGitHubIssueOrPullRequest,
} from "./references.js";

test("parses GitHub Issue and Pull Request URLs", () => {
  assert.deepEqual(
    parseGitHubIssueOrPullRequestUrl("https://github.com/gyuniverse-hq/example/issues/12?foo=bar#x"),
    {
      kind: "issue",
      owner: "gyuniverse-hq",
      repository: "example",
      number: 12,
      canonicalUrl: "https://github.com/gyuniverse-hq/example/issues/12",
    },
  );

  assert.deepEqual(
    parseGitHubIssueOrPullRequestUrl("https://github.com/gyuniverse-hq/example/pull/7"),
    {
      kind: "pull_request",
      owner: "gyuniverse-hq",
      repository: "example",
      number: 7,
      canonicalUrl: "https://github.com/gyuniverse-hq/example/pull/7",
    },
  );
});

test("rejects unsupported or ambiguous GitHub URLs", () => {
  assert.throws(() => parseGitHubIssueOrPullRequestUrl("http://github.com/a/b/issues/1"));
  assert.throws(() => parseGitHubIssueOrPullRequestUrl("https://example.com/a/b/issues/1"));
  assert.throws(() => parseGitHubIssueOrPullRequestUrl("https://github.com/a/b/issues"));
  assert.throws(() => parseGitHubIssueOrPullRequestUrl("https://github.com/a/b/discussions/1"));
  assert.throws(() => parseGitHubIssueOrPullRequestUrl("https://github.com/a/b/issues/0"));
});

class ResolveClient extends GitHubGraphQlClient {
  lastVariables: Record<string, unknown> | null = null;

  constructor() {
    super("test-token");
  }

  override async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    this.lastVariables = variables;

    if (query.includes("issue(number: $number)")) {
      return {
        repository: {
          issue: {
            id: "I_12",
            number: 12,
            title: "Issue title",
            url: "https://github.com/gyuniverse-hq/example/issues/12",
            state: "OPEN",
            repository: { nameWithOwner: "gyuniverse-hq/example" },
          },
        },
      } as T;
    }

    return {
      repository: {
        pullRequest: {
          id: "PR_7",
          number: 7,
          title: "PR title",
          url: "https://github.com/gyuniverse-hq/example/pull/7",
          state: "MERGED",
          merged: true,
          repository: { nameWithOwner: "gyuniverse-hq/example" },
        },
      },
    } as T;
  }
}

test("resolves Issue and Pull Request URLs to GraphQL content node IDs", async () => {
  const client = new ResolveClient();

  const issue = await resolveGitHubIssueOrPullRequest(
    client,
    "https://github.com/gyuniverse-hq/example/issues/12",
  );
  assert.equal(issue.contentId, "I_12");
  assert.equal(issue.kind, "issue");
  assert.equal(issue.repositoryWithOwner, "gyuniverse-hq/example");
  assert.equal(issue.merged, null);
  assert.deepEqual(client.lastVariables, {
    owner: "gyuniverse-hq",
    name: "example",
    number: 12,
  });

  const pullRequest = await resolveGitHubIssueOrPullRequest(
    client,
    "https://github.com/gyuniverse-hq/example/pull/7",
  );
  assert.equal(pullRequest.contentId, "PR_7");
  assert.equal(pullRequest.kind, "pull_request");
  assert.equal(pullRequest.merged, true);
});
