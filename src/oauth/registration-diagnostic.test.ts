import assert from "node:assert/strict";
import test from "node:test";
import { registerOAuthClient } from "./endpoints.js";
import { logRegistrationRejection } from "./registration-diagnostic.js";

const base = {
  client_name: "Claude",
  redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};
const request = (body: unknown) => new Request("https://example.test/oauth/register", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("DCR: every explicit 400 branch has a fixed, value-free diagnostic", async (t) => {
  const cases = [
    { patch: { redirect_uris: undefined }, reason: "redirect_uris_missing_or_invalid", error: "invalid_redirect_uri" },
    { patch: { redirect_uris: [] }, reason: "redirect_uris_missing_or_invalid", error: "invalid_redirect_uri" },
    { patch: { redirect_uris: "https://claude.ai/api/mcp/auth_callback" }, reason: "redirect_uris_missing_or_invalid", error: "invalid_redirect_uri" },
    { patch: { redirect_uris: [base.redirect_uris[0], "https://unapproved.example/callback"] }, reason: "redirect_uri_not_allowed", error: "invalid_redirect_uri" },
    { patch: { token_endpoint_auth_method: "client_secret_post" }, reason: "unsupported_token_endpoint_auth_method", error: "invalid_client_metadata" },
    { patch: { token_endpoint_auth_method: "client_secret_basic" }, reason: "unsupported_token_endpoint_auth_method", error: "invalid_client_metadata" },
    { patch: { grant_types: ["authorization_code", "client_credentials"] }, reason: "unsupported_grant_type", error: "invalid_client_metadata" },
    { patch: { grant_types: ["refresh_token"] }, reason: "authorization_code_missing", error: "invalid_client_metadata" },
    { patch: { grant_types: [] }, reason: "authorization_code_missing", error: "invalid_client_metadata" },
    { patch: { response_types: ["code", "token"] }, reason: "unsupported_response_type", error: "invalid_client_metadata" },
  ];
  const log = t.mock.method(console, "info", () => {});
  for (const item of cases) {
    log.mock.resetCalls();
    const response = await registerOAuthClient(request({ ...base, ...item.patch }));
    assert.equal(response.status, 400);
    const payload = await response.json() as { error: string; error_description?: string };
    const expectedPayload = item.error === "invalid_redirect_uri"
      ? { error: item.error, error_description: "Unsupported redirect URI." }
      : item.reason === "unsupported_token_endpoint_auth_method"
        ? { error: item.error, error_description: "Dynamic registration supports public PKCE clients only." }
        : { error: item.error };
    assert.deepEqual(payload, expectedPayload);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(log.mock.calls.length, 1);
    assert.equal(log.mock.calls[0].arguments[0], "oauth_register_rejected");
    assert.equal(log.mock.calls[0].arguments[1].reason, item.reason);
    assert.equal(log.mock.calls[0].arguments[1].route, "/oauth/register");
    assert.deepEqual(Object.keys(log.mock.calls[0].arguments[1]), ["route", "reason", "fields"]);
  }
  log.mock.resetCalls();
  const invalid = new Request("https://example.test/oauth/register", { method: "POST", body: "not-json-secret" });
  const invalidResponse = await registerOAuthClient(invalid);
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), { error: "invalid_client_metadata" });
  assert.deepEqual(log.mock.calls[0].arguments, ["oauth_register_rejected", { route: "/oauth/register", reason: "json_parse_failed", fields: [] }]);
});

test("DCR: documented Claude public-client metadata, defaults and extra fields already succeed", async (t) => {
  const before = process.env.MCP_OAUTH_SIGNING_SECRET;
  process.env.MCP_OAUTH_SIGNING_SECRET = "local-dcr-diagnostic-test-only";
  const log = t.mock.method(console, "info", () => {});
  try {
    const bodies = [
      base,
      { redirect_uris: base.redirect_uris },
      { ...base, token_endpoint_auth_method: null, grant_types: null, response_types: null, client_name: null },
      { ...base, redirect_uris: ["https://claude.com/api/mcp/auth_callback"] },
      { ...base, grant_types: ["authorization_code"] },
      { ...base, response_types: [], client_name: "x".repeat(121) },
      { ...base, scope: "projects:read offline_access", application_type: "web", software_id: "fixture", software_version: "1", software_statement: "ignored-fixture", arbitrary_extension: { ignored: true } },
    ];
    for (const body of bodies) {
      const response = await registerOAuthClient(request(body));
      assert.equal(response.status, 201);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.token_endpoint_auth_method, "none");
      assert.deepEqual(payload.response_types, ["code"]);
      assert.equal(payload.client_secret, undefined);
      assert.equal(payload.scope, undefined);
    }
    assert.equal(log.mock.calls.length, 0);
  } finally {
    if (before === undefined) delete process.env.MCP_OAUTH_SIGNING_SECRET;
    else process.env.MCP_OAUTH_SIGNING_SECRET = before;
  }
});

test("DCR diagnostics exclude values, unknown keys, headers and secrets", async (t) => {
  const secret = "sensitive-sentinel-do-not-log";
  const log = t.mock.method(console, "info", () => {});
  const response = await registerOAuthClient(new Request("https://example.test/oauth/register", {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, Cookie: secret },
    body: JSON.stringify({ ...base, client_name: secret, scope: secret, software_statement: secret,
      token_endpoint_auth_method: secret, client_id: secret, client_secret: secret, access_token: secret,
      refresh_token: secret, code: secret, access_code: secret, [secret]: secret }),
  }));
  assert.equal(response.status, 400);
  const event = log.mock.calls[0].arguments;
  assert.deepEqual(event, ["oauth_register_rejected", {
    route: "/oauth/register",
    reason: "unsupported_token_endpoint_auth_method",
    fields: ["redirect_uris", "token_endpoint_auth_method", "grant_types", "response_types", "client_name", "scope", "software_statement"],
  }]);
  assert.equal(JSON.stringify(event).includes(secret), false);
});

test("DCR diagnostics cannot change the error response if logging throws", async (t) => {
  t.mock.method(console, "info", () => { throw new Error("logger unavailable"); });
  assert.equal((await registerOAuthClient(request({}))).status, 400);
  assert.doesNotThrow(() => logRegistrationRejection("json_parse_failed"));
});

test("DCR diagnostics preserve first-failure order and never log redirect values", async (t) => {
  const log = t.mock.method(console, "info", () => {});
  const response = await registerOAuthClient(request({
    ...base, redirect_uris: ["https://unapproved.example/callback?code=secret-sentinel"],
    token_endpoint_auth_method: "client_secret_post", grant_types: ["client_credentials"],
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_redirect_uri", error_description: "Unsupported redirect URI." });
  assert.equal(log.mock.calls.length, 1);
  assert.deepEqual(log.mock.calls[0].arguments, ["oauth_register_rejected", {
    route: "/oauth/register", reason: "redirect_uri_not_allowed",
    fields: ["redirect_uris", "token_endpoint_auth_method", "grant_types", "response_types", "client_name"],
  }]);
});

test("DCR logger inspects presence only, with bounded allowlisted output", (t) => {
  const log = t.mock.method(console, "info", () => {});
  const body = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`unknown-secret-key-${i}`, "secret-value"]));
  Object.defineProperty(body, "client_name", { get: () => { throw new Error("must not read value"); } });
  logRegistrationRejection("redirect_uris_missing_or_invalid", body);
  assert.deepEqual(log.mock.calls[0].arguments, ["oauth_register_rejected", {
    route: "/oauth/register", reason: "redirect_uris_missing_or_invalid", fields: ["client_name"],
  }]);
});

test("DCR: malformed JSON shapes currently throw rather than returning validation 400", async () => {
  // Characterization only: do not conflate these separate hardening gaps with the observed 400.
  for (const body of [null, { ...base, grant_types: "authorization_code" },
    { ...base, response_types: "code" }, { ...base, client_name: 123 }]) {
    await assert.rejects(registerOAuthClient(request(body)), TypeError);
  }
});
