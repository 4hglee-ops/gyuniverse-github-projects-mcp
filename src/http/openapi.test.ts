import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "./openapi.js";
import { handleRemoteHttpRequest } from "./router.js";

test("OpenAPI advertises semantic read and write endpoints with OAuth scopes", () => {
  const document = openApiDocument("https://example.test");
  assert.equal(document.openapi, "3.1.0");
  assert.equal(document.info.version, "0.3.0");
  assert.ok(document.paths["/api/v1/identity"]);
  assert.ok(document.paths["/api/v1/project/brief"]);
  assert.ok(document.paths["/api/v1/project/my-work"]);
  assert.ok(document.paths["/api/v1/project/backlog"]);
  assert.ok(document.paths["/api/v1/project/review-queue"]);
  assert.ok(document.paths["/api/v1/project/unassigned"]);
  assert.ok(document.paths["/api/v1/project/blockers"]);
  assert.ok(document.paths["/api/v1/write/status"]);
  assert.ok(document.paths["/api/v1/write/priority"]);
  assert.ok(document.paths["/api/v1/write/start-work"]);
  assert.ok(document.paths["/api/v1/write/assign"]);
  assert.ok(document.paths["/api/v1/write/capture-backlog"]);
  assert.ok(document.paths["/api/v1/write/create-work-item"]);
  assert.equal(document.components.securitySchemes.oauth2.flows.authorizationCode.authorizationUrl, "https://example.test/oauth/authorize");
  assert.equal(document.components.securitySchemes.oauth2.flows.authorizationCode.tokenUrl, "https://example.test/oauth/token");
  assert.deepEqual(document.paths["/api/v1/write/status"].post.security, [{ oauth2: ["projects:read", "projects:write"] }]);
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
  const payload = await response.json() as { openapi?: string; servers?: Array<{ url?: string }> };
  assert.equal(payload.openapi, "3.1.0");
  assert.equal(payload.servers?.[0]?.url, "https://example.test");
});
