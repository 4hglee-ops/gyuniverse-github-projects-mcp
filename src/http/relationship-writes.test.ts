import assert from "node:assert/strict";
import test from "node:test";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { signEnvelope } from "../oauth/stateless.js";
import { handleRemoteMcpRequest } from "./remote-mcp.js";

test("Production HTTP MCP adapter lists and authorizes four writes; viewer/member/read-scope remain read-only", { timeout: 10000 }, async () => {
  const values: Record<string, string> = {
    PUBLIC_BASE_URL: "https://local-test.example",
    MCP_OAUTH_SIGNING_SECRET: "local-test-signing-secret-never-production",
    M10_GOVERNANCE_STORE: "memory",
    MCP_OAUTH_IDENTITIES_JSON: JSON.stringify(["admin", "member", "viewer"].map(role => ({ subject: `user:${role}`, role, accessCode: `test-${role}`, projectIds: ["PVT"] }))),
  };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const queries: string[] = [];
  let subIssue = false;
  let blockedBy = false;
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      queries.push(query);
      if (query.includes("mutation GuardedIssueRelationship")) {
        const args = variables.input as { issueId: string; subIssueId?: string; blockingIssueId?: string };
        assert.equal(args.issueId, "I1");
        assert.equal(args.subIssueId ?? args.blockingIssueId, "I2");
        if (args.subIssueId) subIssue = query.includes("result: addSubIssue");
        else blockedBy = query.includes("result: addBlockedBy");
        return { result: { issue: { id: "I1" }, target: { id: "I2" } } } as T;
      }
      if (query.includes("RelationshipProjectItems")) return { node: { __typename: "ProjectV2", id: "PVT", items: { nodes: [
        { id: "ITEM1", content: { __typename: "Issue", id: "I1", title: "Test", number: 1, state: "OPEN", url: "https://github.com/gyuniverse-hq/repo/issues/1", repository: { nameWithOwner: "gyuniverse-hq/repo" } } },
        { id: "ITEM2", content: { __typename: "Issue", id: "I2", title: "Test 2", number: 2, state: "OPEN", url: "https://github.com/gyuniverse-hq/repo/issues/2", repository: { nameWithOwner: "gyuniverse-hq/repo" } } },
      ], pageInfo: { hasNextPage: false, endCursor: null } } } } as T;
      if (query.includes("IssueRelationships")) {
        const id = variables.issueId;
        const connection = (target: string | null) => ({ nodes: target ? [{ id: target }] : [], totalCount: target ? 1 : 0, pageInfo: { hasNextPage: false, endCursor: null } });
        return { node: { __typename: "Issue", id, parent: id === "I2" && subIssue ? { id: "I1" } : null,
          subIssues: connection(id === "I1" && subIssue ? "I2" : null),
          blockedBy: connection(id === "I1" && blockedBy ? "I2" : null),
          blocking: connection(id === "I2" && blockedBy ? "I1" : null) } } as T;
      }
      return { repositoryOwner: { projectV2: { id: "PVT" } } } as T;
    }
  }
  const config = { githubToken: "test", allowedOwners: ["gyuniverse-hq"], allowedProjectIds: ["PVT"], writeEnabled: true };
  const names = ["add_github_project_sub_issue", "remove_github_project_sub_issue", "add_github_project_blocked_by", "remove_github_project_blocked_by"];
  try {
    for (const [role, scope] of [["viewer", "projects:read"], ["member", "projects:read projects:write"], ["admin", "projects:read"], ["admin", "projects:read projects:write"]]) {
      const allowed = role === "admin" && scope!.includes("projects:write");
      const mutationsBefore = queries.filter(query => /\bmutation\b/.test(query)).length;
      const now = Math.floor(Date.now() / 1000);
      const token = await signEnvelope("gypa", { typ: "access_token", aud: `${values.PUBLIC_BASE_URL}/mcp`, sub: `user:${role}`, scope, iat: now, exp: now + 60 });
      let id = 0;
      const invoke = async (method: string, params: object) => {
        const response = await handleRemoteMcpRequest(new Request(`${values.PUBLIC_BASE_URL}/mcp`, {
          method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-11-25" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        }), { config, client: new Client("test") });
        assert.equal(response.status, 200);
        const raw = await response.text();
        const payload = response.headers.get("content-type")?.includes("text/event-stream")
          ? JSON.parse(raw.split(/\r?\n/).find(line => line.startsWith("data:"))!.slice(5)) : JSON.parse(raw);
        assert.equal(payload.error, undefined);
        return payload.result;
      };
      const listing = await invoke("tools/list", {});
      for (const name of names) {
        assert.equal(listing.tools.find((tool: { name: string }) => tool.name === name).annotations.readOnlyHint, false);
        const result = await invoke("tools/call", { name, arguments: { owner: "gyuniverse-hq", number: 2, sourceItemId: "ITEM1", targetItemId: "ITEM2" } });
        if (allowed) {
          assert.notEqual(result.isError, true);
          const body = JSON.parse(result.content[0].text);
          assert.equal(body.verified, true);
          assert.equal(body.changed, true);
          assert.equal(body.actorId, "user:admin");
          assert.equal(body.operation, name.replace("_github_project", ""));
        } else assert.equal(result.isError, true);
      }
      assert.equal(queries.filter(query => /\bmutation\b/.test(query)).length - mutationsBefore, allowed ? 4 : 0);
      const read = await invoke("tools/call", { name: "get_github_project_item_relationships", arguments: { owner: "gyuniverse-hq", number: 2, itemId: "ITEM1" } });
      assert.notEqual(read.isError, true);
      assert.equal(JSON.parse(read.content[0].text).source.contentId, "I1");
    }
    assert.equal(subIssue, false);
    assert.equal(blockedBy, false);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
