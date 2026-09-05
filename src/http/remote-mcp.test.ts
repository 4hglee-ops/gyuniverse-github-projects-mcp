import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../config.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { configForRemoteScope, resolveRemotePrincipal } from "./remote-mcp.js";

const base: AppConfig = {
  githubToken: "test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_PROJECT"],
  writeEnabled: true,
};

test("remote OAuth read scope forces GitHub writes off even when server write gate is on", () => {
  const effective = configForRemoteScope(base, "projects:read");
  assert.equal(effective.writeEnabled, false);
  assert.deepEqual(effective.allowedProjectIds, ["PVT_PROJECT"]);
});

test("remote OAuth write scope never overrides a disabled server write gate", () => {
  const effective = configForRemoteScope({ ...base, writeEnabled: false }, "projects:read projects:write");
  assert.equal(effective.writeEnabled, false);
});

test("remote writes require both server write gate and OAuth write scope", () => {
  const effective = configForRemoteScope(base, "projects:read projects:write");
  assert.equal(effective.writeEnabled, true);
});

test("individual subject resolves role, login, and Project memberships from registry", () => {
  const registry = new OAuthIdentityRegistry([
    {
      subject: "user:honggyu",
      accessCode: "secret-code",
      githubLogin: "4hglee-ops",
      role: "admin",
      projectIds: ["PVT_PROJECT"],
    },
  ]);
  const principal = resolveRemotePrincipal(
    "user:honggyu",
    "projects:read projects:write",
    base,
    registry,
  );
  assert.equal(principal?.id, "user:honggyu");
  assert.equal(principal?.githubLogin, "4hglee-ops");
  assert.equal(principal?.role, "admin");
  assert.deepEqual(principal?.projectIds, ["PVT_PROJECT"]);
});

test("unknown individual subject fails closed while legacy team subject keeps temporary compatibility", () => {
  const empty = new OAuthIdentityRegistry([]);
  assert.equal(resolveRemotePrincipal("user:unknown", "projects:read", base, empty), null);

  const legacy = resolveRemotePrincipal(
    "gyuniverse-projects-team",
    "projects:read projects:write",
    base,
    empty,
  );
  assert.equal(legacy?.role, "admin");
  assert.deepEqual(legacy?.projectIds, ["PVT_PROJECT"]);
});
