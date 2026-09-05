import assert from "node:assert/strict";
import test from "node:test";

import { OAuthIdentityRegistry } from "./oauth-identity-registry.js";

test("registry resolves an access code to an individual principal", () => {
  const registry = new OAuthIdentityRegistry([
    {
      subject: "user:honggyu",
      accessCode: "code-admin",
      displayName: "Honggyu",
      githubLogin: "4hglee-ops",
      role: "admin",
      projectIds: ["PVT_allowed"],
    },
    {
      subject: "user:member",
      accessCode: "code-member",
      role: "member",
      projectIds: ["PVT_allowed"],
    },
  ]);

  assert.equal(registry.resolveByAccessCode("code-admin")?.subject, "user:honggyu");
  const principal = registry.resolvePrincipal("user:honggyu");
  assert.equal(principal?.role, "admin");
  assert.equal(principal?.githubLogin, "4hglee-ops");
  assert.deepEqual(principal?.projectIds, ["PVT_allowed"]);
  assert.equal(registry.resolveByAccessCode("unknown"), null);
});

test("registry rejects duplicate subjects, duplicate codes, and missing Project membership", () => {
  assert.throws(() => new OAuthIdentityRegistry([
    { subject: "user:one", accessCode: "same", role: "member", projectIds: ["PVT_allowed"] },
    { subject: "user:two", accessCode: "same", role: "viewer", projectIds: ["PVT_allowed"] },
  ]), /Duplicate OAuth identity accessCode/);

  assert.throws(() => new OAuthIdentityRegistry([
    { subject: "user:one", accessCode: "one", role: "member", projectIds: [] },
  ]), /must allow at least one Project/);
});

test("environment registry is empty by default and validates JSON", () => {
  const before = process.env.MCP_OAUTH_IDENTITIES_JSON;
  try {
    delete process.env.MCP_OAUTH_IDENTITIES_JSON;
    assert.equal(OAuthIdentityRegistry.fromEnvironment().resolvePrincipal("user:none"), null);

    process.env.MCP_OAUTH_IDENTITIES_JSON = "not-json";
    assert.throws(() => OAuthIdentityRegistry.fromEnvironment(), /must be valid JSON/);
  } finally {
    if (before === undefined) delete process.env.MCP_OAUTH_IDENTITIES_JSON;
    else process.env.MCP_OAUTH_IDENTITIES_JSON = before;
  }
});
