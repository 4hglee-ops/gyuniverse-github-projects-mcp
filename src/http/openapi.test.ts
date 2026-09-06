import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "./openapi.js";
import { handleRemoteHttpRequest } from "./router.js";

test("OpenAPI advertises semantic read and write endpoints with OAuth scopes", () => {
  const document = openApiDocument("https://example.test");
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.version, "0.5.0");
  assert.ok(document.paths["/api/v1/identity"]);
  assert.ok(document.paths["/api/v1/project/brief"]);
  assert.ok(document.paths["/api/v1/project/my-work"]);
  assert.ok(document.paths["/api/v1/project/backlog"]);
  assert.ok(document.paths["/api/v1/project/review-queue"]);
  assert.ok(document.paths["/api/v1/project/unassigned"]);
  assert.ok(document.paths["/api/v1/project/blockers"]);
  assert.ok(document.paths["/api/v1/project/item-relationships"]);
  assert.ok(document.paths["/api/v1/project/bulk-plan"]);
  assert.ok(document.paths["/api/v1/write/status"]);
  assert.ok(document.paths["/api/v1/write/priority"]);
  assert.ok(document.paths["/api/v1/write/start-work"]);
  assert.ok(document.paths["/api/v1/write/assign"]);
  assert.ok(document.paths["/api/v1/write/capture-backlog"]);
  assert.ok(document.paths["/api/v1/write/create-work-item"]);
  assert.ok(document.paths["/api/v1/write/relationship/add-sub-issue"]);
  assert.ok(document.paths["/api/v1/write/relationship/remove-sub-issue"]);
  assert.ok(document.paths["/api/v1/write/relationship/add-blocked-by"]);
  assert.ok(document.paths["/api/v1/write/relationship/remove-blocked-by"]);
  assert.ok(document.paths["/api/v1/write/bulk/preview"]);
  assert.ok(document.paths["/api/v1/write/bulk/approve"]);
  assert.ok(document.paths["/api/v1/write/bulk/apply"]);
  assert.deepEqual(document.components.schemas, {});
  assert.equal(document.components.securitySchemes.oauth2.flows.authorizationCode.authorizationUrl, "https://example.test/oauth/authorize");
  assert.equal(document.components.securitySchemes.oauth2.flows.authorizationCode.tokenUrl, "https://example.test/oauth/token");
  assert.deepEqual(document.paths["/api/v1/write/status"].post.security, [{ oauth2: ["projects:read", "projects:write"] }]);
});

test("OpenAPI exposes all M10 relationship and bulk operation IDs without secrets", () => {
  const document = openApiDocument("https://example.test");
  const operationIds = Object.values(document.paths).flatMap((path) =>
    Object.values(path).flatMap((operation) => "operationId" in operation ? [operation.operationId] : []));
  const expected = [
    "get_github_project_item_relationships",
    "add_github_project_sub_issue",
    "remove_github_project_sub_issue",
    "add_github_project_blocked_by",
    "remove_github_project_blocked_by",
    "preview_github_project_bulk_updates",
    "approve_github_project_bulk_plan",
    "apply_github_project_bulk_plan",
    "get_github_project_bulk_plan",
  ];
  for (const operationId of expected) assert.ok(operationIds.includes(operationId), operationId);

  const serialized = JSON.stringify(document);
  for (const forbidden of ["client_secret", "access_token", "refresh_token", "authorization code", "cookie"]) {
    assert.doesNotMatch(serialized.toLowerCase(), new RegExp(forbidden.replace(" ", "\\s+")));
  }
});

test("every OpenAPI operation description is at most 300 characters", () => {
  const document = openApiDocument("https://example.test");
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!("operationId" in operation)) continue;
      const description = "description" in operation && typeof operation.description === "string"
        ? operation.description
        : "";
      assert.ok(
        description.length <= 300,
        `${operation.operationId} ${method.toUpperCase()} ${path}: ${description.length} characters`,
      );
    }
  }
});

test("OpenAPI teaches GPT Actions to use friendly Project item references without inventing IDs or owners", () => {
  const document = openApiDocument("https://example.test");
  type ActionSchema = { required: readonly string[]; properties: Record<string, { description: string }> };
  const read = document.paths["/api/v1/project/item-relationships"].post.requestBody.content["application/json"].schema as ActionSchema;
  assert.deepEqual(read.required, ["number"]);
  assert.ok("url" in read.properties);
  assert.ok("repository" in read.properties);
  assert.ok("itemNumber" in read.properties);
  assert.match(read.properties.itemId.description, /do not invent/i);
  assert.match(read.properties.itemNumber.description, /unique inside the authorized Project/i);
  assert.match(read.properties.owner.description, /Never infer.*githubLogin/i);

  const relationship = document.paths["/api/v1/write/relationship/add-sub-issue"].post;
  const relationshipSchema = relationship.requestBody.content["application/json"].schema as ActionSchema;
  assert.deepEqual(relationshipSchema.required, ["number"]);
  assert.ok("sourceUrl" in relationshipSchema.properties);
  assert.ok("sourceNumber" in relationshipSchema.properties);
  assert.ok("targetUrl" in relationshipSchema.properties);
  assert.ok("targetNumber" in relationshipSchema.properties);
  assert.match(relationship.description, /same authorized Project/i);

  const bulk = document.paths["/api/v1/write/bulk/preview"].post;
  const bulkSchema = bulk.requestBody.content["application/json"].schema as {
    properties: { operations: { items: ActionSchema } };
  };
  const operation = bulkSchema.properties.operations.items;
  assert.deepEqual(operation.required, ["field", "value"]);
  assert.ok("url" in operation.properties);
  assert.ok("repository" in operation.properties);
  assert.ok("number" in operation.properties);
  assert.match(bulk.description, /before the immutable Preview is persisted/i);
});

test("OpenAPI tells actions not to blindly retry non-idempotent partial failures", () => {
  const document = openApiDocument("https://example.test");
  const create = document.paths["/api/v1/write/create-work-item"].post;
  assert.match(create.description, /not idempotent/i);
  assert.match(create.description, /Never automatically retry CREATE_WORK_ITEM_PARTIAL_FAILURE/);

  const errorSchema = create.responses["400"].content["application/json"].schema;
  const error = errorSchema.properties.error;
  assert.deepEqual(error.required, ["code", "message", "category", "retryable", "userAction"]);
  assert.ok(error.properties.retryable);
  assert.ok(error.properties.userAction);
  assert.ok(error.properties.category);
});

test("router serves OpenAPI without OAuth", async () => {
  const response = await handleRemoteHttpRequest(new Request("https://example.test/openapi.json"));
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    openapi?: string;
    servers?: Array<{ url?: string }>;
    paths?: Record<string, { post?: { operationId?: string } }>;
  };
  assert.equal(payload.openapi, "3.1.0");
  assert.equal(payload.servers?.[0]?.url, "https://example.test");
  assert.equal(payload.paths?.["/api/v1/write/bulk/apply"]?.post?.operationId, "apply_github_project_bulk_plan");
  assert.equal(payload.paths?.["/api/v1/project/item-relationships"]?.post?.operationId, "get_github_project_item_relationships");
});
