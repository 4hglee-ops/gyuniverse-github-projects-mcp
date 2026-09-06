import assert from "node:assert/strict";
import test from "node:test";

import { handleRestApiRequest } from "./rest-api.js";

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
