import assert from "node:assert/strict";
import test from "node:test";

import { actionErrorAdvice, handleRestApiRequest, restPathRequiresWrite } from "./rest-api.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { GitHubRestClient } from "../github/rest-client.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { signEnvelope } from "../oauth/stateless.js";
import { MemoryViewPlanStore } from "../core/views/view-plan-store.js";
import { MemoryWriteAuditStore } from "../core/audit/audit-store.js";
import { AuditService } from "../core/audit/audit-service.js";

test("REST API rejects missing bearer token before loading runtime config", async () => {
  const response = await handleRestApiRequest(new Request("https://example.test/api/v1/identity"));
  assert.equal(response.status, 401);
  const payload = await response.json() as {
    ok?: boolean;
    error?: { code?: string; category?: string; retryable?: boolean; userAction?: string };
  };
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.code, "UNAUTHORIZED");
  assert.equal(payload.error?.category, "authentication");
  assert.equal(payload.error?.retryable, false);
  assert.match(payload.error?.userAction ?? "", /Reconnect|re-authorize/);
});

test("REST API returns 404 outside the versioned surface", async () => {
  const response = await handleRestApiRequest(new Request("https://example.test/not-rest"));
  assert.equal(response.status, 404);
});

test("REST write routes are explicitly separated from read routes", () => {
  assert.equal(restPathRequiresWrite("/api/v1/write/status"), true);
  assert.equal(restPathRequiresWrite("/api/v1/write/create-work-item"), true);
  assert.equal(restPathRequiresWrite("/api/v1/write/relationship/add-sub-issue"), true);
  assert.equal(restPathRequiresWrite("/api/v1/write/bulk/apply"), true);
  assert.equal(restPathRequiresWrite("/api/v1/project/backlog"), false);
  assert.equal(restPathRequiresWrite("/api/v1/project/item-relationships"), false);
  assert.equal(restPathRequiresWrite("/api/v1/project/bulk-plan"), false);
  assert.equal(restPathRequiresWrite("/api/v1/identity"), false);
});

test("REST write route without bearer token is rejected before mutation setup", async () => {
  const response = await handleRestApiRequest(new Request("https://example.test/api/v1/write/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: "gyuniverse-hq", number: 2, itemId: "PVTI_ITEM", status: "Todo" }),
  }));
  assert.equal(response.status, 401);
  const payload = await response.json() as { error?: { code?: string; retryable?: boolean } };
  assert.equal(payload.error?.code, "UNAUTHORIZED");
  assert.equal(payload.error?.retryable, false);
});

test("action error guidance prevents blind retry for authorization and partial failures", () => {
  assert.deepEqual(actionErrorAdvice("OAUTH_WRITE_SCOPE_REQUIRED"), {
    category: "authorization",
    retryable: false,
    userAction: "Reconnect with projects:write scope before retrying this write action.",
  });

  const partial = actionErrorAdvice("CREATE_WORK_ITEM_PARTIAL_FAILURE");
  assert.equal(partial.category, "partial_failure");
  assert.equal(partial.retryable, false);
  assert.match(partial.userAction, /Do not create another Issue automatically/);

  const auditFailure = actionErrorAdvice("AUDIT_PERSISTENCE_FAILED");
  assert.equal(auditFailure.category, "partial_failure");
  assert.equal(auditFailure.retryable, false);
  assert.match(auditFailure.userAction, /Do not retry/);

  const ambiguous = actionErrorAdvice("MUTATION_VERIFICATION_FAILED");
  assert.equal(ambiguous.category, "conflict");
  assert.equal(ambiguous.retryable, false);
  assert.match(ambiguous.userAction, /Re-read/);
});

test("unknown upstream failures allow at most one state-aware retry", () => {
  const advice = actionErrorAdvice("UNEXPECTED_WRITE_ERROR");
  assert.equal(advice.category, "upstream");
  assert.equal(advice.retryable, true);
  assert.match(advice.userAction, /Retry once/);
  assert.match(advice.userAction, /re-reading current Project state/);
});

test("REST View routes enforce scopes/roles and share stored Core plans across requests", async () => {
  const vars = { PUBLIC_BASE_URL: "https://views.example.invalid", MCP_OAUTH_SIGNING_SECRET: "synthetic-view-test-secret-never-issued-externally", M12_TEAM_ACL_MODE: "legacy" };
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  let name = "Original", mutations = 0, requests = 0;
  const conn = (nodes: unknown[] = []) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      requests++;
      if (query.includes("mutation")) {
        mutations++; name = (variables.input as { name: string }).name;
        return { updateProjectV2View: { projectV2View: { id: "V" } } } as T;
      }
      return { repositoryOwner: { __typename: "Organization", projectV2: { id: variables.number === 2 ? "OTHER" : "PVT", number: variables.number,
        title: "Fixture", url: null, viewerCanUpdate: true, fields: conn([{ id: "F", name: "Title", dataType: "TEXT" }]),
        views: conn([{ id: "V", number: 1, name, layout: "TABLE_LAYOUT", filter: null,
          configuration: { visibleFields: conn([{ id: "F", name: "Title" }]) }, groupByFields: conn(), verticalGroupByFields: conn(), sortByFields: conn() }]),
      } } } as T;
    }
  }
  const client = new Client("synthetic-unused"), store = new MemoryViewPlanStore();
  const registry = new OAuthIdentityRegistry((["viewer", "member", "admin"] as const).map((role) => ({
    subject: "fixture-" + role, accessCode: "synthetic-" + role, role, projectIds: ["PVT"],
  })));
  const options = { client, viewPlanStore: store, identityRegistry: registry, auditService: new AuditService(200, new MemoryWriteAuditStore()),
    config: { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT", "OTHER"], writeEnabled: true },
    restClient: new GitHubRestClient("synthetic-unused", { fetchImplementation: async () => { throw new Error("Unexpected external REST call in offline update test"); } }),
  };
  const call = async (role: "viewer" | "member" | "admin", path: string, body: object, scope = "projects:read projects:write") => {
    // Offline synthetic bearer fixture only: no login, OAuth endpoint or live credential is used.
    const now = Math.floor(Date.now() / 1000);
    const token = await signEnvelope("gypa", { typ: "access_token", sub: "fixture-" + role, aud: vars.PUBLIC_BASE_URL + "/mcp", scope, iat: now, exp: now + 60 });
    return handleRestApiRequest(new Request(vars.PUBLIC_BASE_URL + path, { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body) }), options);
  };
  try {
    const target = { owner: "fixture-org", number: 3 };
    assert.equal((await call("viewer", "/api/v1/project/views", target, "projects:read")).status, 200);
    const preview = await call("viewer", "/api/v1/project/views/preview", { ...target, update: { viewId: "V", changes: { name: "Renamed" } } }, "projects:read");
    assert.equal(preview.status, 200);
    const plan = (await preview.json() as { data: { planId: string; planDigest: string } }).data;
    const input = { ...target, planId: plan.planId, planDigest: plan.planDigest, approved: true };
    const count = requests;
    const readOnly = await call("admin", "/api/v1/write/views/update", input, "projects:read");
    assert.equal(readOnly.status, 403);
    assert.equal(requests, count, "Read-only scope fails before GitHub calls");
    for (const role of ["viewer", "member"] as const) assert.equal((await call(role, "/api/v1/write/views/update", input)).status, 403);
    assert.equal(mutations, 0);
    const invalid = await call("admin", "/api/v1/write/views/update", { ...input, approved: false });
    assert.equal(invalid.status, 400);
    const applied = await call("admin", "/api/v1/write/views/update", input);
    assert.equal(applied.status, 200);
    assert.equal((await applied.json() as { data: { state: string } }).data.state, "completed");
    assert.equal((await call("admin", "/api/v1/write/views/update", input)).status, 200);
    assert.equal(mutations, 1);
    assert.equal((await call("admin", "/api/v1/project/views", { ...target, number: 2 })).status, 403);
    assert.equal((await call("admin", "/api/v1/project/views/preview", { ...target, update: { viewId: "V", changes: { sortBy: [] } } })).status, 400);
    assert.equal((await call("admin", "/api/v1/write/views/delete", input)).status, 404);
    assert.equal(mutations, 1);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
