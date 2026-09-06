import assert from "node:assert/strict";
import test from "node:test";

import { handleRestApiRequest, restPathRequiresWrite } from "./rest-api.js";

test("REST API rejects missing bearer token before loading runtime config", async () => {
  const response = await handleRestApiRequest(new Request("https://example.test/api/v1/identity"));
  assert.equal(response.status, 401);
  const payload = await response.json() as { ok?: boolean; error?: { code?: string } };
  assert.equal(payload.ok, false);
  assert.equal(payload.error?.code, "UNAUTHORIZED");
});

test("REST API returns 404 outside the versioned surface", async () => {
  const response = await handleRestApiRequest(new Request("https://example.test/not-rest"));
  assert.equal(response.status, 404);
});

test("REST write routes are explicitly separated from read routes", () => {
  assert.equal(restPathRequiresWrite("/api/v1/write/status"), true);
  assert.equal(restPathRequiresWrite("/api/v1/write/create-work-item"), true);
  assert.equal(restPathRequiresWrite("/api/v1/project/backlog"), false);
  assert.equal(restPathRequiresWrite("/api/v1/identity"), false);
});

test("REST write route without bearer token is rejected before mutation setup", async () => {
  const response = await handleRestApiRequest(new Request("https://example.test/api/v1/write/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: "gyuniverse-hq", number: 2, itemId: "PVTI_ITEM", status: "Todo" }),
  }));
  assert.equal(response.status, 401);
  const payload = await response.json() as { error?: { code?: string } };
  assert.equal(payload.error?.code, "UNAUTHORIZED");
});
