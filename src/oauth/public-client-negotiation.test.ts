import assert from "node:assert/strict";
import test from "node:test";
import { authorizeOAuth, registerOAuthClient, tokenOAuth } from "./endpoints.js";
import {
  canonicalMcpResource, nowSeconds, OAUTH_READ_SCOPE, sha256Base64Url,
  signEnvelope, verifyEnvelope,
  type AuthorizationCodePayload, type RefreshTokenPayload, type RegisteredClientPayload,
} from "./stateless.js";

const baseUrl = "https://projects.example.test";
const redirectUri = "https://claude.ai/api/mcp/auth_callback";
const testEnv = {
  PUBLIC_BASE_URL: baseUrl,
  MCP_OAUTH_SIGNING_SECRET: "negotiation-test-signing-secret",
  MCP_OAUTH_TEAM_CODE: "negotiation-test-access-code",
  MCP_OAUTH_IDENTITIES_JSON: undefined,
  GPT_ACTIONS_OAUTH_CLIENT_ID: "preconfigured-actions-client",
  GPT_ACTIONS_OAUTH_CLIENT_SECRET: "preconfigured-actions-secret",
};

async function withEnv(fn: () => Promise<void>) {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(testEnv)) {
    before.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await fn(); } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const formRequest = (route: string, fields: Record<string, string>, authorization?: string) =>
  new Request(`${baseUrl}/oauth/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: new URLSearchParams(fields),
  });

async function issuedCode(fields: Record<string, string>) {
  const response = await authorizeOAuth(formRequest("authorize", fields));
  assert.equal(response.status, 303);
  const location = response.headers.get("location");
  assert.ok(location);
  const code = new URL(location).searchParams.get("code");
  assert.ok(code);
  return code;
}

for (const requested of ["none", "client_secret_basic", "client_secret_post", "legacy"]) {
  test(`DCR ${requested}: public registration, mandatory S256, exchange and refresh`, async (t) => {
    await withEnv(async () => {
      const log = t.mock.method(console, "info", () => {});
      let clientId: string;
      if (requested === "legacy") {
        // Pre-patch signed registrations have no explicit effective-method field.
        clientId = await signEnvelope("gyprc", {
          typ: "registered_client", redirectUris: [redirectUri],
          clientName: "legacy", iat: nowSeconds(),
        } satisfies RegisteredClientPayload);
      } else {
        const response = await registerOAuthClient(new Request(`${baseUrl}/oauth/register`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            redirect_uris: [redirectUri], token_endpoint_auth_method: requested,
            grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
            client_name: `Claude-${requested}`, scope: OAUTH_READ_SCOPE, application_type: "web",
          }),
        }));
        assert.equal(response.status, 201);
        const registration = await response.json() as Record<string, unknown>;
        assert.equal(registration.token_endpoint_auth_method, "none");
        assert.equal(Object.hasOwn(registration, "client_secret"), false);
        assert.equal(Object.hasOwn(registration, "client_secret_expires_at"), false);
        assert.equal(typeof registration.client_id, "string");
        clientId = registration.client_id as string;
        const stored = await verifyEnvelope<RegisteredClientPayload>(clientId, "gyprc");
        assert.deepEqual(stored, {
          typ: "registered_client", redirectUris: [redirectUri],
          clientName: `Claude-${requested}`, tokenEndpointAuthMethod: "none",
          iat: registration.client_id_issued_at,
        });
      }
      const verifier = `verifier-${requested}-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`;
      const authFields = {
        response_type: "code", client_id: clientId, redirect_uri: redirectUri,
        state: `state-${requested}`, resource: canonicalMcpResource(), scope: OAUTH_READ_SCOPE,
        access_code: testEnv.MCP_OAUTH_TEAM_CODE,
        code_challenge: await sha256Base64Url(verifier), code_challenge_method: "S256",
      };
      for (const patch of [
        { code_challenge: "", code_challenge_method: "S256" },
        { code_challenge: verifier, code_challenge_method: "plain" },
        { code_challenge: authFields.code_challenge, code_challenge_method: "" },
      ]) {
        const invalid = await authorizeOAuth(formRequest("authorize", { ...authFields, ...patch }));
        assert.equal(invalid.status, 400);
        assert.equal(invalid.headers.get("location"), null);
      }
      const code = await issuedCode(authFields);
      const payload = await verifyEnvelope<AuthorizationCodePayload>(code, "gypac");
      assert.equal(payload?.clientMode, "public_pkce");
      assert.equal(payload?.codeChallenge, authFields.code_challenge);
      const exchange = {
        grant_type: "authorization_code", client_id: clientId, code,
        redirect_uri: redirectUri, resource: canonicalMcpResource(), code_verifier: verifier,
      };
      for (const [code_verifier, error] of [["", "invalid_request"], ["wrong-verifier", "invalid_grant"]]) {
        const response = await tokenOAuth(formRequest("token", { ...exchange, code_verifier }));
        assert.equal(response.status, 400);
        assert.equal((await response.json() as { error: string }).error, error);
      }
      // Even a valid configured GPT Actions secret cannot make a DCR client confidential.
      const secret = testEnv.GPT_ACTIONS_OAUTH_CLIENT_SECRET;
      for (const response of [
        await tokenOAuth(formRequest("token", { ...exchange, client_secret: secret })),
        await tokenOAuth(formRequest("token", exchange, `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`)),
      ]) {
        assert.equal(response.status, 401);
        assert.equal((await response.json() as { error: string }).error, "invalid_client");
      }
      const response = await tokenOAuth(formRequest("token", exchange));
      assert.equal(response.status, 200);
      const tokens = await response.json() as { access_token: string; refresh_token: string };
      assert.match(tokens.access_token, /^gypa\./);
      assert.equal((await verifyEnvelope<RefreshTokenPayload>(tokens.refresh_token, "gyprf"))?.clientMode, "public_pkce");
      const replay = await tokenOAuth(formRequest("token", exchange));
      assert.equal(replay.status, 400);
      assert.equal((await replay.json() as { error: string }).error, "invalid_grant");
      const refresh = {
        grant_type: "refresh_token", client_id: clientId,
        refresh_token: tokens.refresh_token, resource: canonicalMcpResource(),
      };
      assert.equal((await tokenOAuth(formRequest("token", { ...refresh, client_secret: secret }))).status, 401);
      assert.equal((await tokenOAuth(formRequest("token", refresh))).status, 200);
      assert.equal(log.mock.calls.length, 0);
    });
  });
}

for (const method of ["client_secret_basic", "client_secret_post"]) {
  test(`preconfigured GPT Actions ${method}: confidential authorization and exchange unchanged`, async () => {
    await withEnv(async () => {
      const clientId = testEnv.GPT_ACTIONS_OAUTH_CLIENT_ID;
      const actionsRedirectUri = `https://chatgpt.com/aip/g-${method.replaceAll("_", "-")}/oauth/callback`;
      const code = await issuedCode({
        response_type: "code", client_id: clientId,
        redirect_uri: actionsRedirectUri,
        state: method, scope: OAUTH_READ_SCOPE, access_code: testEnv.MCP_OAUTH_TEAM_CODE,
      });
      const payload = await verifyEnvelope<AuthorizationCodePayload>(code, "gypac");
      assert.equal(payload?.clientMode, "gpt_actions_confidential");
      assert.equal(payload?.codeChallenge, "");
      const fields = {
        grant_type: "authorization_code", code, client_id: clientId,
        redirect_uri: actionsRedirectUri,
      };
      const authenticate = (secret: string) => method === "client_secret_basic"
        ? formRequest("token", fields, `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`)
        : formRequest("token", { ...fields, client_secret: secret });
      assert.equal((await tokenOAuth(formRequest("token", fields))).status, 401);
      assert.equal((await tokenOAuth(authenticate("wrong-secret"))).status, 401);
      assert.equal((await tokenOAuth(authenticate(testEnv.GPT_ACTIONS_OAUTH_CLIENT_SECRET))).status, 200);
    });
  });
}
