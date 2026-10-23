import assert from "node:assert/strict";
import test from "node:test";

import { authorizeOAuth, tokenOAuth } from "./endpoints.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
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

test("versioned individual proof survives code exchange/refresh, rejects rotation and never upgrades legacy refreshes", async () => {
  const signing = "synthetic-version-propagation-signing-key-never-used-externally";
  const identity = { subject: "user:versioned", accessCode: "synthetic-version-code", role: "admin", projectIds: ["PVT"] };
  await withEnv({ PUBLIC_BASE_URL: "https://version.example.invalid", MCP_OAUTH_SIGNING_SECRET: signing,
    MCP_OAUTH_IDENTITIES_JSON: JSON.stringify([identity]), MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON: undefined }, async () => {
    const now = nowSeconds(), verifier = "synthetic-version-pkce-verifier-at-least-43-characters";
    const client = await signEnvelope("gyprc", { typ: "registered_client", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"], iat: now });
    const form = new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
      resource: canonicalMcpResource(), scope: OAUTH_READ_SCOPE, code_challenge: await sha256Base64Url(verifier), code_challenge_method: "S256", access_code: identity.accessCode });
    const approved = await authorizeOAuth(new Request("https://version.example.invalid/oauth/authorize", { method: "POST", body: form }));
    assert.equal(approved.status, 303); const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const payload = await verifyEnvelope<AuthorizationCodePayload>(code, "gypac");
    const version = OAuthIdentityRegistry.fromEnvironment().credentialVersion(identity.subject, signing);
    assert.equal(payload!.identityVersion, version);
    const exchange = await tokenOAuth(new Request("https://version.example.invalid/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code,
      client_id: client, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", resource: canonicalMcpResource(), code_verifier: verifier }) }));
    assert.equal(exchange.status, 200);
    const issued = await exchange.json() as { access_token: string; refresh_token: string };
    assert.equal((await verifyEnvelope<{ identityVersion: string }>(issued.access_token, "gypa"))!.identityVersion, version);
    const refresh = (value: string) => tokenOAuth(new Request("https://version.example.invalid/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: value, client_id: client, resource: canonicalMcpResource() }) }));
    const renewed = await refresh(issued.refresh_token); assert.equal(renewed.status, 200);
    assert.equal((await verifyEnvelope<{ identityVersion: string }>((await renewed.json() as { refresh_token: string }).refresh_token, "gyprf"))!.identityVersion, version);
    process.env.MCP_OAUTH_IDENTITIES_JSON = JSON.stringify([{ ...identity, accessCode: "rotated-synthetic-code" }]);
    assert.equal((await refresh(issued.refresh_token)).status, 400);
    const legacy = await signEnvelope("gyprf", { typ: "refresh_token", aud: canonicalMcpResource(), clientId: client, sub: identity.subject, scope: OAUTH_READ_SCOPE, iat: now, exp: now + 3600 });
    const legacyRenewed = await refresh(legacy); assert.equal(legacyRenewed.status, 200);
    assert.equal((await verifyEnvelope<{ identityVersion?: string }>((await legacyRenewed.json() as { access_token: string }).access_token, "gypa"))!.identityVersion, undefined);
  });
});
