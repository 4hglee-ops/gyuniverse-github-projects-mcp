import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { InMemoryTransport, type JSONRPCMessage, type JSONRPCRequest } from "@modelcontextprotocol/server";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import type { AuthenticatedPrincipal } from "../core/identity/principal.js";
import { restrictPrincipalToTeamAccess } from "../core/teams/team-access.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { TARGET_PROJECT } from "../project-foundation/operating-foundation.js";
import { KBEAUTY_WBS_FIELDS, KBEAUTY_WBS_PROJECT } from "../project-foundation/wbs-field-setup.js";
import { buildMcpServer } from "./build-server.js";

const project2 = TARGET_PROJECT.id;
const project3 = KBEAUTY_WBS_PROJECT.id;
const registry = new OAuthIdentityRegistry([{
  subject: "user:integration-admin", accessCode: "synthetic-integration-code", role: "admin",
  projectIds: [project2, project3],
}]);

function scopedPrincipal(project3Role: "viewer" | "admin", includeProject2 = true) {
  return restrictPrincipalToTeamAccess(registry.resolvePrincipal("user:integration-admin")!, { grants: [
    ...(includeProject2 ? [{
      teamId: "team-2", resourceId: "resource-2", provider: "github_projects" as const,
      externalResourceId: project2, teamRole: "admin" as const, grantRole: "admin" as const, permissions: null,
    }] : []),
    {
      teamId: "team-3", resourceId: "resource-3", provider: "github_projects",
      externalResourceId: project3, teamRole: project3Role, grantRole: "admin", permissions: null,
    },
  ] });
}

class FixtureClient extends GitHubGraphQlClient {
  readonly calls: Array<{ query: string; variables: Record<string, unknown> }> = [];

  constructor() { super("synthetic-unused-token"); }

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ query, variables });
    assert.doesNotMatch(query, /\bmutation\b/, "Compatibility checks must never mutate GitHub");
    const id = variables.number === 2 ? project2 : project3;
    if (query.includes("fields(first: 100)")) {
      return { repositoryOwner: { projectV2: { fields: { nodes: [
        { id: "status-field", name: "Status", dataType: "SINGLE_SELECT", options: [{ name: "Backlog" }] },
        ...KBEAUTY_WBS_FIELDS.map((spec, i) => ({ id: "field-" + i, ...spec })),
      ] } } } } as T;
    }
    if (query.includes("items(first: $pageSize")) {
      const offset = variables.after === "page-100" ? 100 : 0;
      const count = Math.min(Number(variables.pageSize), 153 - offset);
      return { repositoryOwner: { projectV2: { items: {
        nodes: Array.from({ length: count }, (_, i) => ({
          id: "fixture-item-" + (offset + i), type: "ISSUE",
          content: { __typename: "Issue", title: "Fixture " + (offset + i), assignees: { nodes: [{ login: "fixture-user" }] } },
          fieldValues: { nodes: [{ __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Backlog", field: { name: "Status" } }] },
        })),
        pageInfo: { hasNextPage: offset + count < 153, endCursor: offset + count < 153 ? "page-100" : null },
      } } } } as T;
    }
    return { repositoryOwner: { projectV2: { id, number: variables.number, title: "Fixture project" } } } as T;
  }
}

async function connect(t: TestContext, principal: AuthenticatedPrincipal) {
  const client = new FixtureClient();
  const server = buildMcpServer({
    config: { githubToken: "synthetic-unused-token", allowedOwners: ["gyuniverse-hq"], allowedProjectIds: [project2, project3], writeEnabled: true },
    client, principal,
  });
  const [transport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await transport.close(); await server.close(); });
  await server.connect(serverTransport);
  await transport.start();
  let id = 0;
  async function request(method: string, params: JSONRPCRequest["params"]) {
    const requestId = ++id;
    const response = new Promise<JSONRPCMessage>((resolve) => {
      transport.onmessage = (message) => { if ("id" in message && message.id === requestId) resolve(message); };
    });
    await transport.send({ jsonrpc: "2.0", id: requestId, method, params });
    const message = await response;
    assert.ok("result" in message, JSON.stringify(message));
    return message.result;
  }
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integration-test", version: "1" } });
  await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    client, request,
    async call(name: string, args: Record<string, unknown>) {
      return await request("tools/call", { name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
    },
  };
}

test("combined MCP retains WBS, diagnostics and governance and reads all 153 items through the Provider", { timeout: 5000 }, async (t) => {
  const { client, request, call } = await connect(t, scopedPrincipal("admin"));
  const listing = await request("tools/list", {}) as { tools: Array<{ name: string }> };
  for (const name of [
    "preview_kbeauty_wbs_fields", "apply_kbeauty_wbs_fields", "get_github_auth_status",
    "get_identity_context", "get_github_project_snapshot", "assign_work_item",
    "get_github_project_item_relationships", "list_github_project_write_audit_log",
    "preview_github_project_bulk_updates", "approve_github_project_bulk_plan", "apply_github_project_bulk_plan",
  ]) assert.ok(listing.tools.some((tool) => tool.name === name), name);

  const items = await call("list_github_project_items", { owner: "gyuniverse-hq", number: 3 });
  assert.notEqual(items.isError, true);
  assert.equal(JSON.parse(items.content[0]!.text).length, 153);

  const result = await call("get_github_project_snapshot", { owner: "gyuniverse-hq", number: 3 });
  assert.notEqual(result.isError, true);
  const snapshot = JSON.parse(result.content[0]!.text);
  assert.equal(snapshot.itemCount, 153);
  assert.equal(snapshot.pagesFetched, 2);
  assert.equal(snapshot.hasMoreItems, false);
  assert.equal(snapshot.requestedLimit, 500);
  assert.deepEqual(snapshot.items[152].assignees, ["fixture-user"]);
  assert.equal(snapshot.items[152].fields.Status, "Backlog");
  assert.deepEqual(client.calls.filter((c) => c.query.includes("items(first: $pageSize")).map((c) => c.variables.after), [null, "page-100", null, "page-100"]);
});

test("M12 team viewer can preview existing Project #3 WBS fields but global admin cannot apply them", { timeout: 5000 }, async (t) => {
  const { client, call } = await connect(t, scopedPrincipal("viewer"));
  const preview = await call("preview_kbeauty_wbs_fields", { owner: "gyuniverse-hq", number: 3 });
  assert.notEqual(preview.isError, true);
  const plan = JSON.parse(preview.content[0]!.text);
  assert.equal(plan.readyForApply, true);
  assert.ok(plan.fields.every((field: { action: string }) => field.action === "skip-existing"));

  const apply = await call("apply_kbeauty_wbs_fields", { owner: "gyuniverse-hq", number: 3 });
  assert.equal(apply.isError, true);
  assert.match(apply.content[0]!.text, /PERMISSION_DENIED/);
  assert.ok(client.calls.every((c) => c.variables.number === 3));
});

test("Provider reads reject an ungranted legacy Project before querying its items", { timeout: 5000 }, async (t) => {
  const { client, call } = await connect(t, scopedPrincipal("admin", false));
  const result = await call("get_github_project_snapshot", { owner: "gyuniverse-hq", number: 2 });
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /PROJECT_MEMBERSHIP_DENIED/);
  assert.equal(client.calls.length, 1);
  assert.doesNotMatch(client.calls[0]!.query, /items\(|fields\(/);
});
