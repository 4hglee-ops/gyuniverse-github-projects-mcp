import assert from "node:assert/strict";
import test from "node:test";

import { actionErrorAdvice, handleRestApiRequest, restPathRequiresWrite } from "./rest-api.js";

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
