import assert from "node:assert/strict";
import test from "node:test";

import { authorizeOAuth } from "./endpoints.js";
import {
  canonicalMcpResource,
  nowSeconds,
  OAUTH_READ_SCOPE,
  sha256Base64Url,
  signEnvelope,
  verifyEnvelope,
  type AuthorizationCodePayload,
  type RegisteredClientPayload,
} from "./stateless.js";

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    before.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("OAuth authorization binds an individual access code to the issued subject", async () => {
  await withEnv(
    {
      PUBLIC_BASE_URL: "https://projects.example.test",
      MCP_OAUTH_SIGNING_SECRET: "test-signing-secret",
      MCP_OAUTH_IDENTITIES_JSON: JSON.stringify([
        {
          subject: "user:honggyu",
          accessCode: "individual-code",
          githubLogin: "4hglee-ops",
          role: "admin",
          projectIds: ["PVT_allowed"],
        },
      ]),
    },
    async () => {
      const now = nowSeconds();
      const clientId = await signEnvelope("gyprc", {
        typ: "registered_client",
        redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        clientName: "ChatGPT",
        iat: now,
      } satisfies RegisteredClientPayload);
      const verifier = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-._~extra";
      const challenge = await sha256Base64Url(verifier);
      const form = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
        state: "state-1",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: canonicalMcpResource(),
        scope: OAUTH_READ_SCOPE,
        access_code: "individual-code",
      });

      const response = await authorizeOAuth(new Request("https://projects.example.test/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "manual",
      }));
      assert.equal(response.status, 303);
      const location = response.headers.get("location");
      assert.ok(location);
      const code = new URL(location).searchParams.get("code");
      assert.ok(code);
      const payload = await verifyEnvelope<AuthorizationCodePayload>(code, "gypac");
      assert.equal(payload?.sub, "user:honggyu");
      assert.equal(payload?.scope, OAUTH_READ_SCOPE);
    },
  );
});
