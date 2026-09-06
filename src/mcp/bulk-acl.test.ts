import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport, type JSONRPCMessage, type JSONRPCRequest } from "@modelcontextprotocol/server";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { principalForRole } from "../core/identity/principal.js";
import { buildMcpServer } from "./build-server.js";

test("bulk tools remain visible but viewer execution is denied by runtime capability checks", async () => {
  class Client extends GitHubGraphQlClient {
    override async request<T>(): Promise<T> {
      return { repositoryOwner: { projectV2: { id: "PVT" } } } as T;
    }
  }
  const server = buildMcpServer({
    config: {
      githubToken: "test",
      allowedOwners: ["gyuniverse-hq"],
      allowedProjectIds: ["PVT"],
      writeEnabled: true,
    },
    client: new Client("test"),
    principal: principalForRole("viewer", "viewer", {
      githubLogin: "gyuniverse-hq",
      projectIds: ["PVT"],
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  let id = 0;
  async function request(method: string, params: JSONRPCRequest["params"]) {
    const requestId = ++id;
    const response = new Promise<JSONRPCMessage>((resolve) => {
      clientTransport.onmessage = (message) => {
        if ("id" in message && message.id === requestId) resolve(message);
      };
    });
    await clientTransport.send({ jsonrpc: "2.0", id: requestId, method, params });
    const message = await response;
    assert.ok("result" in message, JSON.stringify(message));
    return message.result;
  }
  try {
    await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "acl-test", version: "1" },
    });
    await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listing = await request("tools/list", {}) as { tools: Array<{ name: string }> };
    assert.ok(listing.tools.some((tool) => tool.name === "preview_github_project_bulk_updates"));

    const result = await request("tools/call", {
      name: "preview_github_project_bulk_updates",
      arguments: {
        owner: "gyuniverse-hq",
        number: 2,
        operations: [{ itemId: "ITEM", field: "Status", value: "Todo" }],
      },
    }) as { isError?: boolean; content: Array<{ text?: string }> };
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /PERMISSION_DENIED.*bulk\.preview/);
  } finally {
    await clientTransport.close();
    await server.close();
  }
});
