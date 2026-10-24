import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { InMemoryTransport, type JSONRPCMessage, type JSONRPCRequest } from "@modelcontextprotocol/server";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { principalForRole } from "../core/identity/principal.js";
import { MemoryViewPlanStore } from "../core/views/view-plan-store.js";
import { buildMcpServer } from "./build-server.js";

async function session(t: TestContext, role: "admin" | "viewer" | "member", writeEnabled = true) {
  let name = "Original", mutations = 0;
  const conn = (nodes: unknown[] = []) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
      if (query.includes("mutation")) { mutations++; name = (vars.input as { name: string }).name; return { updateProjectV2View: { projectV2View: { id: "V" } } } as T; }
      return { repositoryOwner: { __typename: "Organization", projectV2: { id: "PVT", number: 3, title: "Fixture", url: null, viewerCanUpdate: true,
        fields: conn([{ id: "F", name: "Title", dataType: "TEXT" }]),
        views: conn([{ id: "V", number: 1, name, layout: "TABLE_LAYOUT", filter: null,
          configuration: { visibleFields: conn([{ id: "F", name: "Title" }]) }, groupByFields: conn(), verticalGroupByFields: conn(), sortByFields: conn() }]),
      } } } as T;
    }
  }
  const server = buildMcpServer({ config: { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT"], writeEnabled },
    client: new Client("synthetic-unused"), principal: principalForRole("fixture-" + role, role, { projectIds: ["PVT"] }), viewPlanStore: new MemoryViewPlanStore() });
  const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await transport.close(); await server.close(); });
  await server.connect(serverTransport); await transport.start();
  let id = 0;
  async function request(method: string, params: JSONRPCRequest["params"]) {
    const requestId = ++id;
    const response = new Promise<JSONRPCMessage>((resolve) => { transport.onmessage = (m) => { if ("id" in m && m.id === requestId) resolve(m); }; });
    await transport.send({ jsonrpc: "2.0", id: requestId, method, params });
    const result = await response; assert.ok("result" in result, JSON.stringify(result)); return result.result;
  }
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "view-test", version: "1" } });
  await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { request, get mutations() { return mutations; }, async call(name: string, args: object) {
    return await request("tools/call", { name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
  } };
}
test("MCP View tools share Core preview/approve/update flow and expose no delete", { timeout: 5000 }, async (t) => {
  const s = await session(t, "admin");
  const listing = await s.request("tools/list", {}) as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
  for (const name of ["list_project_views", "preview_project_view_setup", "apply_project_view_setup", "update_project_view"]) assert.ok(listing.tools.some((tool) => tool.name === name));
  assert.ok(!listing.tools.some((tool) => tool.name === "delete_project_view"));
  assert.equal(listing.tools.find((tool) => tool.name === "preview_project_view_setup")!.annotations!.readOnlyHint, true);
  const planResult = await s.call("preview_project_view_setup", { owner: "fixture-org", number: 3, update: { viewId: "V", changes: { name: "Renamed" } } });
  assert.notEqual(planResult.isError, true);
  const plan = JSON.parse(planResult.content[0]!.text);
  assert.equal(s.mutations, 0);
  const input = { owner: "fixture-org", number: 3, planId: plan.planId, planDigest: plan.planDigest, approved: true };
  const result = await s.call("update_project_view", input);
  assert.notEqual(result.isError, true);
  assert.equal(JSON.parse(result.content[0]!.text).state, "completed");
  await s.call("update_project_view", input);
  assert.equal(s.mutations, 1);
});
test("MCP Viewer/Member and effective read-only config cannot perform a View write", { timeout: 5000 }, async (t) => {
  for (const [role, writable] of [["viewer", true], ["member", true], ["admin", false]] as const) {
    const s = await session(t, role, writable);
    const preview = await s.call("preview_project_view_setup", { owner: "fixture-org", number: 3, update: { viewId: "V", changes: { name: "Renamed" } } });
    const plan = JSON.parse(preview.content[0]!.text);
    const result = await s.call("update_project_view", { owner: "fixture-org", number: 3, planId: plan.planId, planDigest: plan.planDigest, approved: true });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /PERMISSION_DENIED|write tools are disabled/);
    assert.equal(s.mutations, 0);
  }
});
