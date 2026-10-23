import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { resolveVerifiedOperator } from "../http/operator-auth.js";
import { signEnvelope } from "../oauth/stateless.js";
import { AdminPolicy, type AdminAuthority } from "./admin-policy.js";
import type { ProjectPermission } from "../core/identity/principal.js";

const key = "synthetic-admin-policy-key-at-least-32-characters";
async function operator(t: TestContext, scope = "projects:read projects:write", projectPermissions?: ProjectPermission[]) {
  const before = [process.env.PUBLIC_BASE_URL, process.env.MCP_OAUTH_SIGNING_SECRET];
  process.env.PUBLIC_BASE_URL = "https://policy.example.invalid"; process.env.MCP_OAUTH_SIGNING_SECRET = key;
  t.after(() => { for (const [i, name] of ["PUBLIC_BASE_URL", "MCP_OAUTH_SIGNING_SECRET"].entries()) { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; } });
  const registry = new OAuthIdentityRegistry([{ subject: "user:admin", accessCode: "synthetic-policy-code", role: "admin", projectIds: ["PVT", "OTHER"] }]);
  const now = Math.floor(Date.now() / 1000), token = await signEnvelope("gypa", { typ: "access_token", sub: "user:admin", aud: "https://policy.example.invalid/mcp",
    scope, iat: now, exp: now + 3600, identityVersion: registry.credentialVersion("user:admin", key) });
  return resolveVerifiedOperator(token, { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT", "OTHER"], writeEnabled: false },
    { registry: () => registry, bindingKey: key, teamStore: () => projectPermissions ? { getSnapshot: async () => ({ grants: [{
      teamId: "team", resourceId: "resource", provider: "github_projects", externalResourceId: "PVT", teamRole: "admin", grantRole: "admin", permissions: projectPermissions,
    }] }) } : null });
}
const authority: AdminAuthority = { subject: "user:admin", operations: ["admin.users.read", "admin.users.write", "admin.credentials.issue", "admin.credentials.revoke", "admin.audit.read"], projectIds: ["PVT"], maxGrantRole: "member" };
test("Project admin role alone cannot grant management rights; disabled/default policies deny", async (t) => {
  const op = await operator(t), request = { operation: "admin.users.read" as const, projectIds: ["PVT"] };
  assert.throws(() => new AdminPolicy().authorize(op, request), /ADMIN_PERMISSION_DENIED/);
  assert.throws(() => new AdminPolicy(authority).authorize(op, request), /ADMIN_PERMISSION_DENIED/);
  assert.throws(() => new AdminPolicy(null, true).authorize(op, request), /ADMIN_PERMISSION_DENIED/);
  assert.throws(() => new AdminPolicy(authority, true).authorize({ ...op }, request), /OPERATOR_AUTH_REQUIRED/);
});
test("explicit management permissions retain actor, full-target scope and role ceilings", async (t) => {
  const op = await operator(t), policy = new AdminPolicy(authority, true);
  assert.deepEqual(policy.authorize(op, { operation: "admin.users.write", projectIds: ["PVT"], targetRole: "viewer" }),
    { allowed: true, actorId: "user:admin", operation: "admin.users.write", projectIds: ["PVT"] });
  for (const request of [
    { operation: "admin.users.write" as const, projectIds: ["PVT"], targetRole: "admin" as const },
    { operation: "admin.users.write" as const, projectIds: ["PVT"] },
    { operation: "admin.credentials.issue" as const, projectIds: ["PVT", "OTHER"], targetRole: "viewer" as const },
    { operation: "admin.credentials.read" as const, projectIds: ["PVT"] },
    { operation: "admin.users.read" as const, projectIds: [] },
    { operation: "admin.users.read" as const, projectIds: ["PVT", "PVT"] },
  ]) assert.throws(() => policy.authorize(op, request), /ADMIN_PERMISSION_DENIED/);
  assert.throws(() => policy.authorize(op, { operation: "admin.users.write", projectIds: ["PVT"], targetRole: "constructor" as never }), /ADMIN_PERMISSION_DENIED/);
  assert.throws(() => new AdminPolicy({ ...authority, subject: "user:other" }, true).authorize(op, { operation: "admin.users.read", projectIds: ["PVT"] }), /ADMIN_PERMISSION_DENIED/);
});
test("read-only OAuth scope cannot become a management write even with explicit authority", async (t) => {
  const op = await operator(t, "projects:read"), policy = new AdminPolicy(authority, true);
  assert.equal(policy.authorize(op, { operation: "admin.users.read", projectIds: ["PVT"] }).allowed, true);
  assert.throws(() => policy.authorize(op, { operation: "admin.credentials.issue", projectIds: ["PVT"], targetRole: "viewer" }), /ADMIN_PERMISSION_DENIED/);
});
test("explicit management authority never overrides a read-only team ACL", async (t) => {
  const op = await operator(t, "projects:read projects:write", ["project.read"]), policy = new AdminPolicy(authority, true);
  assert.equal(policy.authorize(op, { operation: "admin.users.read", projectIds: ["PVT"] }).allowed, true);
  for (const operation of ["admin.users.write", "admin.credentials.issue", "admin.credentials.revoke"] as const) {
    assert.throws(() => policy.authorize(op, { operation, projectIds: ["PVT"], targetRole: "viewer" }), /ADMIN_PERMISSION_DENIED/);
  }
});
test("requested role capabilities cannot exceed current per-Project capability ceilings", async (t) => {
  const op = await operator(t, "projects:read projects:write", ["project.read", "project.write"]), policy = new AdminPolicy(authority, true);
  assert.equal(policy.authorize(op, { operation: "admin.users.write", projectIds: ["PVT"], targetRole: "viewer" }).allowed, true);
  assert.throws(() => policy.authorize(op, { operation: "admin.users.write", projectIds: ["PVT"], targetRole: "member" }), /ADMIN_PERMISSION_DENIED/);
});
