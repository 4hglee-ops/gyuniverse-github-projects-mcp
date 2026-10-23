import assert from "node:assert/strict";
import test from "node:test";
import { GitHubGraphQlClient } from "./graphql-client.js";
import { GitHubRestClient } from "./rest-client.js";
import { readProjectViews, readViewFields, readRestViewFieldIds, createProjectView, updateProjectView, restFieldIds } from "./project-views.js";

const end = { hasNextPage: false, endCursor: null };
const conn = (nodes: unknown[] = []) => ({ nodes, pageInfo: end });
const node = (id: string) => ({ id, number: 1, name: "Existing", layout: "TABLE_LAYOUT", filter: null,
  configuration: { visibleFields: conn([{ id: "F", name: "Title" }]) },
  groupByFields: conn(), verticalGroupByFields: conn(), sortByFields: conn() });
class QueryClient extends GitHubGraphQlClient {
  calls: Array<{ query: string; vars: Record<string, unknown> }> = [];
  constructor(private readonly reply: (vars: Record<string, unknown>, query: string) => unknown) { super("synthetic-unused"); }
  override async request<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> { this.calls.push({ query, vars }); return this.reply(vars, query) as T; }
}
const envelope = (views: unknown[], info: { hasNextPage: boolean; endCursor: string | null } = end) => ({ repositoryOwner: { __typename: "Organization", projectV2: {
  id: "PVT", number: 3, title: "Fixture", url: null, viewerCanUpdate: true, views: { nodes: views, pageInfo: info },
} } });
test("View reads follow cursors and preserve IDs, visible columns and complete configuration", async () => {
  const client = new QueryClient((v) => v.after ? envelope([node("V2")]) : envelope([node("V1")], { hasNextPage: true, endCursor: "next" }));
  const result = await readProjectViews(client, "fixture-org", 3);
  assert.deepEqual(result.views.map((v) => v.id), ["V1", "V2"]);
  assert.deepEqual(result.views[0]!.visibleFieldIds, ["F"]);
  assert.deepEqual(client.calls.map((v) => v.vars.after), [null, "next"]);
  assert.ok(client.calls.every((v) => !v.query.includes("mutation")));
});
test("View reads reject duplicates, cursor cycles and truncated nested fields", async () => {
  const duplicate = new QueryClient((v) => v.after ? envelope([node("V")]) : envelope([node("V")], { hasNextPage: true, endCursor: "next" }));
  await assert.rejects(() => readProjectViews(duplicate, "fixture-org", 3), /VIEW_RESPONSE_INCOMPLETE/);
  const cycle = new QueryClient((v) => envelope([node(v.after ? "V2" : "V1")], { hasNextPage: true, endCursor: "next" }));
  await assert.rejects(() => readProjectViews(cycle, "fixture-org", 3), /VIEW_CURSOR_INVALID/);
  const truncated = { ...node("V"), configuration: { visibleFields: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "more" } } } };
  await assert.rejects(() => readProjectViews(new QueryClient(() => envelope([truncated])), "fixture-org", 3), /VIEW_RESPONSE_INCOMPLETE/);
});
test("View reads preserve configured column order and explicit empty columns without falling back to fields", async () => {
  const projectOrder = [{ id: "F_TITLE", name: "Title" }, { id: "F_STATUS", name: "Status" }];
  for (const configured of [[...projectOrder].reverse(), []]) {
    const client = new QueryClient(() => envelope([{ ...node("V"), fields: conn(projectOrder),
      configuration: { visibleFields: conn(configured) } }]));
    const result = await readProjectViews(client, "fixture-org", 3);
    assert.deepEqual(result.views[0]!.visibleFieldIds, configured.map((f) => f.id));
    assert.deepEqual(result.views[0]!.visibleFields, configured.map((f) => f.name));
    assert.match(client.calls[0]!.query, /configuration\s*\{\s*visibleFields\(first: 100\)/);
    assert.doesNotMatch(client.calls[0]!.query, /\bfields\(first:/);
  }
});
test("Missing or malformed configured columns fail closed even when legacy fields are available", async () => {
  for (const configuration of [undefined, null, {}, { visibleFields: null },
    { visibleFields: conn([null]) }, { visibleFields: { nodes: [] } },
    { visibleFields: conn([{ name: "Missing ID" }]) }]) {
    const client = new QueryClient(() => envelope([{ ...node("V"),
      fields: conn([{ id: "F", name: "Title" }]), configuration }]));
    await assert.rejects(() => readProjectViews(client, "fixture-org", 3), /VIEW_RESPONSE_INVALID/);
  }
});
test("Duplicate or oversized configured column responses are never treated as complete", async () => {
  for (const columns of [[{ id: "F", name: "Title" }, { id: "F", name: "Title" }],
    Array.from({ length: 101 }, (_, i) => ({ id: "F" + i, name: "Field " + i }))]) {
    const client = new QueryClient(() => envelope([{ ...node("V"), configuration: { visibleFields: conn(columns) } }]));
    await assert.rejects(() => readProjectViews(client, "fixture-org", 3), /VIEW_RESPONSE_INCOMPLETE/);
  }
});
test("Field reads paginate and REST IDs are integers mapped by node ID, never field name", async () => {
  const client = new QueryClient((v) => ({ repositoryOwner: { projectV2: { fields: {
    nodes: [{ id: v.after ? "F2" : "F1", name: "Same name", dataType: "TEXT" }],
    pageInfo: v.after ? end : { hasNextPage: true, endCursor: "more" },
  } } } }));
  assert.deepEqual((await readViewFields(client, "fixture-org", 3)).map((f) => f.id), ["F1", "F2"]);
  assert.deepEqual([...restFieldIds([{ node_id: "F2", id: 42 }, { node_id: "F1", id: 99 }])], [["F2", 42], ["F1", 99]]);
  assert.throws(() => restFieldIds([{ node_id: "F1", id: 1 }, { node_id: "F1", id: 2 }]), /VIEW_FIELD_IDS_INVALID/);
  assert.throws(() => restFieldIds([{ node_id: "F1", id: 1.5 }]), /VIEW_FIELD_IDS_INVALID/);
});
test("REST create uses existing API version and integer columns; full field page blocks planning", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const rest = new GitHubRestClient("synthetic-unused", { fetchImplementation: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).includes("/fields") ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, node_id: "F" + i })) : { value: { node_id: "V_NEW" } });
  } });
  assert.equal(await createProjectView(rest, "fixture-org", 3, { name: "Board", layout: "board", visible_fields: [42], vertical_group_by: [42] }), "V_NEW");
  assert.equal((calls[0]!.init!.headers as Record<string, string>)["X-GitHub-Api-Version"], "2026-03-10");
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)).visible_fields, [42]);
  await assert.rejects(() => readRestViewFieldIds(rest, "fixture-org", 3), /VIEW_FIELDS_INCOMPLETE/);
});
test("GraphQL updates send only supported fields and bind the returned View ID", async () => {
  const client = new QueryClient(() => ({ updateProjectV2View: { projectV2View: { id: "V" } } }));
  await updateProjectView(client, "V", { name: "Renamed", filter: "", layout: "board", visibleFieldIds: ["F"] });
  assert.deepEqual(client.calls[0]!.vars.input, { viewId: "V", name: "Renamed", filter: "", layout: "BOARD_LAYOUT", configuration: { visibleFieldIds: ["F"] } });
  await assert.rejects(() => updateProjectView(client, "V", { group_by: [1] } as never));
  assert.equal(client.calls.length, 1);
});
test("Upstream authorization/rate-limit/server errors are bounded and never echo private bodies", async () => {
  for (const status of [401, 403, 404, 422, 429, 503]) {
    const client = new QueryClient(() => { throw new Error(`GitHub GraphQL request failed (${status}): private-upstream-body`); });
    await assert.rejects(() => readProjectViews(client, "fixture-org", 3), (error: Error) => {
      assert.match(error.message, new RegExp("VIEW_UPSTREAM_" + status));
      assert.doesNotMatch(error.message, /private-upstream-body/); return true;
    });
  }
});

test("View request timeout reports an unknown outcome without automatically retrying", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new QueryClient(() => new Promise(() => {}));
  const pending = readProjectViews(client, "fixture-org", 3);
  t.mock.timers.tick(10_001);
  await assert.rejects(pending, /VIEW_UPSTREAM_TIMEOUT/);
  assert.equal(client.calls.length, 1);
});
