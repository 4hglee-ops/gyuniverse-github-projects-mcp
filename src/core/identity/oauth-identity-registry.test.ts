import assert from "node:assert/strict";
import test from "node:test";

import { OAuthIdentityRegistry } from "./oauth-identity-registry.js";

test("credential versions are server-keyed, stable and change on code or key rotation without exposing codes", () => {
  const record = { subject: "user:fixture", accessCode: "synthetic-version-code", role: "admin" as const, projectIds: ["PVT"] };
  const key = "synthetic-version-binding-server-key-at-least-32-characters";
  const registry = new OAuthIdentityRegistry([record]);
  const version = registry.credentialVersion(record.subject, key)!;
  assert.match(version, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(registry.credentialVersion(record.subject, key), version);
  assert.notEqual(registry.credentialVersion(record.subject, key + "rotated"), version);
  assert.notEqual(new OAuthIdentityRegistry([{ ...record, accessCode: "rotated-synthetic-code" }]).credentialVersion(record.subject, key), version);
  assert.equal(registry.credentialVersion("unknown", key), null);
  assert.throws(() => registry.credentialVersion(record.subject, "short"), /OPERATOR_BINDING_CONFIG_INVALID/);
  assert.doesNotMatch(version, /synthetic-version-code/);
});

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
  ]), /must allow between one and 100/);
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

test("additional OAuth identities preserve legacy membership and grant new Project access separately", () => {
  const original = process.env.MCP_OAUTH_IDENTITIES_JSON;
  const additional = process.env.MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON;
  try {
    process.env.MCP_OAUTH_IDENTITIES_JSON = JSON.stringify([
      { subject: "user:legacy", accessCode: "legacy-code", githubLogin: "legacy-user", role: "member", projectIds: ["PVT_project2"] },
    ]);
    process.env.MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON = JSON.stringify([
      { subject: "user:final-admin", accessCode: "new-admin-code", githubLogin: "final-admin", role: "admin", projectIds: ["PVT_project2", "PVT_project3"] },
      { subject: "user:final-member", accessCode: "new-member-code", githubLogin: "final-member", role: "member", projectIds: ["PVT_project3"] },
    ]);
    const registry = OAuthIdentityRegistry.fromEnvironment();
    assert.deepEqual(registry.resolvePrincipal("user:legacy")?.projectIds, ["PVT_project2"]);
    assert.deepEqual(registry.resolvePrincipal("user:final-admin")?.projectIds, ["PVT_project2", "PVT_project3"]);
    assert.equal(registry.resolvePrincipal("user:final-admin")?.role, "admin");
    assert.equal(registry.resolvePrincipal("user:final-member")?.role, "member");
    assert.equal(registry.resolvePrincipal("user:final-member")?.permissions.includes("item.create"), false);
    assert.equal(registry.resolveByAccessCode("legacy-code")?.subject, "user:legacy");
    assert.equal(registry.resolveByAccessCode("new-member-code")?.subject, "user:final-member");

    // Duplicate subjects or codes across the two secrets must fail closed.
    process.env.MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON = JSON.stringify([
      { subject: "user:other", accessCode: "legacy-code", role: "viewer", projectIds: ["PVT_project3"] },
    ]);
    assert.throws(() => OAuthIdentityRegistry.fromEnvironment(), /Duplicate OAuth identity accessCode/);
    process.env.MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON = "{bad-json";
    assert.throws(() => OAuthIdentityRegistry.fromEnvironment(), /MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON must be valid JSON/);
  } finally {
    if (original === undefined) delete process.env.MCP_OAUTH_IDENTITIES_JSON;
    else process.env.MCP_OAUTH_IDENTITIES_JSON = original;
    if (additional === undefined) delete process.env.MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON;
    else process.env.MCP_OAUTH_ADDITIONAL_IDENTITIES_JSON = additional;
  }
});

test("identity permissions may safely narrow but never expand role defaults", () => {
  const registry = new OAuthIdentityRegistry([{
    subject: "user:approver",
    accessCode: "approver-code",
    role: "admin",
    projectIds: ["PVT_allowed"],
    permissions: ["project.read", "project.write", "bulk.approve"],
  }]);
  assert.deepEqual(registry.resolvePrincipal("user:approver")?.permissions, [
    "project.read", "project.write", "bulk.approve",
  ]);

  assert.throws(() => new OAuthIdentityRegistry([{
    subject: "user:viewer",
    accessCode: "viewer-code",
    role: "viewer",
    projectIds: ["PVT_allowed"],
    permissions: ["project.read", "bulk.apply"],
  }]), /may narrow but not expand/);

  assert.throws(() => new OAuthIdentityRegistry([{
    subject: "user:invalid",
    accessCode: "invalid-code",
    role: "admin",
    projectIds: ["PVT_allowed"],
    permissions: ["project.read", "not-a-capability" as never],
  }]), /supported capability names/);
});
