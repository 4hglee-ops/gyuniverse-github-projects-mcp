import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport, type JSONRPCMessage, type JSONRPCRequest } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { principalForRole } from "../core/identity/principal.js";
import { buildMcpServer } from "./build-server.js";

test("MCP advertises read-only relationships, invokes Shared Core, and preserves existing tools", { timeout: 5000 }, async () => {
  const queries: string[] = [];
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string): Promise<T> {
      queries.push(query);
      if (query.includes("RelationshipProjectItems")) return { node: { __typename: "ProjectV2", id: "PVT", items: {
        nodes: [{ id: "ITEM", content: { __typename: "Issue", id: "ISSUE", number: 1, title: "Test",
          url: "https://github.com/gyuniverse-hq/repo/issues/1", state: "OPEN", repository: { nameWithOwner: "gyuniverse-hq/repo" } } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      } } } as T;
      if (query.includes("IssueRelationships")) {
        const empty = { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } };
        return { node: { __typename: "Issue", id: "ISSUE", parent: null, subIssues: empty, blocking: empty, blockedBy: empty } } as T;
      }
      return { repositoryOwner: { projectV2: { id: "PVT" } } } as T;
    }
  }
  const server = buildMcpServer({ config: { githubToken: "test", allowedOwners: ["gyuniverse-hq"], allowedProjectIds: ["PVT"], writeEnabled: false },
    client: new Client("test"), principal: principalForRole("viewer", "viewer", { projectIds: ["PVT"] }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  let id = 0;
  async function request(method: string, params: JSONRPCRequest["params"]) {
    const requestId = ++id;
    const response = new Promise<JSONRPCMessage>((resolve) => {
      clientTransport.onmessage = (message) => { if ("id" in message && message.id === requestId) resolve(message); };
    });
    await clientTransport.send({ jsonrpc: "2.0", id: requestId, method, params });
    const message = await response;
    assert.ok("result" in message, JSON.stringify(message));
    return message.result;
  }
  try {
    await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listing = z.object({ tools: z.array(z.object({ name: z.string(), annotations: z.object({ readOnlyHint: z.boolean().optional() }).optional() })) }).parse(await request("tools/list", {}));
    const tool = listing.tools.find((tool) => tool.name === "get_github_project_item_relationships");
    assert.equal(tool?.annotations?.readOnlyHint, true);
    for (const name of ["get_blockers", "get_project_brief", "get_github_project_snapshot", "list_github_project_write_audit_log"]) {
      assert.ok(listing.tools.some((tool) => tool.name === name), name);
    }
    const result = z.object({ content: z.array(z.object({ text: z.string() })), isError: z.boolean().optional() }).parse(await request("tools/call", {
      name: "get_github_project_item_relationships", arguments: { owner: "gyuniverse-hq", number: 2, itemId: "ITEM" },
    }));
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(result.content[0]!.text).source.contentId, "ISSUE");
    assert.equal(queries.length, 3);
    assert.ok(queries.every((query) => !/\bmutation\b/.test(query)));
  } finally {
    await clientTransport.close();
    await server.close();
  }
});
