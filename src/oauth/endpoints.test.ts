import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizationCodeReplayStore,
  authorizationServerMetadata,
  protectedResourceMetadata,
  registerOAuthClient,
  tokenOAuth,
} from "./endpoints.js";
import {
  canonicalMcpResource,
  OAUTH_READ_SCOPE,
  OAUTH_WRITE_SCOPE,
  sha256Base64Url,
  signEnvelope,
  type AuthorizationCodePayload,
  nowSeconds,
  oauthAccessTokenPayload,
} from "./stateless.js";

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    before.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("protected resource metadata is read-only by default", async () => {
  await withEnv(
    {
      PUBLIC_BASE_URL: "https://projects.example.test",
      MCP_OAUTH_WRITE_ENABLED: undefined,
    },
    () => {
      assert.deepEqual(protectedResourceMetadata(), {
        resource: "https://projects.example.test/mcp",
        authorization_servers: ["https://projects.example.test"],
        scopes_supported: [OAUTH_READ_SCOPE],
        bearer_methods_supported: ["header"],
      });
      const server = authorizationServerMetadata() as { scopes_supported: string[] };
      assert.deepEqual(server.scopes_supported, [OAUTH_READ_SCOPE]);
    },
  );
});

test("write scope is advertised only when explicitly enabled", async () => {
  await withEnv(
    {
      PUBLIC_BASE_URL: "https://projects.example.test",
      MCP_OAUTH_WRITE_ENABLED: "true",
    },
    () => {
      const resource = protectedResourceMetadata() as { scopes_supported: string[] };
      assert.deepEqual(resource.scopes_supported, [OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE]);
    },
  );
});

test("dynamic client registration accepts ChatGPT callback and rejects arbitrary redirects", async () => {
  await withEnv({ MCP_OAUTH_SIGNING_SECRET: "test-signing-secret" }, async () => {
    const accepted = await registerOAuthClient(new Request("https://example.test/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT",
        redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }));
    assert.equal(accepted.status, 201);
    const payload = await accepted.json() as { client_id: string };
    assert.match(payload.client_id, /^gyprc\./);

    const rejected = await registerOAuthClient(new Request("https://example.test/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
    }));
    assert.equal(rejected.status, 400);
  });
});

test("authorization code token exchange preserves individual subject and rejects replay", async () => {
  await withEnv(
    {
      PUBLIC_BASE_URL: "https://projects.example.test",
      MCP_OAUTH_SIGNING_SECRET: "test-signing-secret",
      MCP_OAUTH_WRITE_ENABLED: undefined,
    },
    async () => {
      const verifier = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._~extra";
      const challenge = await sha256Base64Url(verifier);
      const now = nowSeconds();
      const code = await signEnvelope("gypac", {
        typ: "authorization_code",
        clientId: "client-1",
        redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
        resource: canonicalMcpResource(),
        scope: OAUTH_READ_SCOPE,
        sub: "user:test",
        codeChallenge: challenge,
        iat: now,
        exp: now + 120,
      } satisfies AuthorizationCodePayload);

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: "client-1",
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        code_verifier: verifier,
        resource: canonicalMcpResource(),
      });

      const first = await tokenOAuth(new Request("https://projects.example.test/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }));
      assert.equal(first.status, 200);
      const token = await first.json() as { access_token: string; scope: string };
      assert.match(token.access_token, /^gypa\./);
      assert.equal(token.scope, OAUTH_READ_SCOPE);
      const payload = await oauthAccessTokenPayload(token.access_token);
      assert.equal(payload?.sub, "user:test");

      const replay = await tokenOAuth(new Request("https://projects.example.test/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }));
      assert.equal(replay.status, 400);
      const replayBody = await replay.json() as { error: string };
      assert.equal(replayBody.error, "invalid_grant");

      assert.ok(authorizationCodeReplayStore);
    },
  );
});
