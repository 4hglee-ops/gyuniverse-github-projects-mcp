import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { signEnvelope } from "../oauth/stateless.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { principalForRole } from "../core/identity/principal.js";
import { resolveVerifiedOperator, revalidateVerifiedOperator, assertSessionBoundOperator, operatorConfig } from "./operator-auth.js";

const key = "synthetic-operator-test-signing-key-never-used-externally";
const config = { githubToken: "synthetic-server-only-github-value", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT", "OTHER"], writeEnabled: true };
const record = { subject: "user:fixture", accessCode: "synthetic-operator-code", role: "admin" as const, projectIds: ["PVT", "UNLISTED"] };
function environment(t: TestContext) {
  const before = [process.env.PUBLIC_BASE_URL, process.env.MCP_OAUTH_SIGNING_SECRET];
  process.env.PUBLIC_BASE_URL = "https://operator.example.invalid"; process.env.MCP_OAUTH_SIGNING_SECRET = key;
  t.after(() => { for (const [i, name] of ["PUBLIC_BASE_URL", "MCP_OAUTH_SIGNING_SECRET"].entries()) { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; } });
}
async function token(extra: object = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signEnvelope("gypa", { typ: "access_token", sub: record.subject, aud: "https://operator.example.invalid/mcp", scope: "projects:read projects:write", iat: now, exp: now + 3600, ...extra });
}
const options = (registry: OAuthIdentityRegistry) => ({ registry: () => registry, teamStore: () => null, bindingKey: key });
test("verified operator binds a versioned personal proof and keeps bearer/server secrets out of serializable metadata", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const bearer = await token({ identityVersion: registry.credentialVersion(record.subject, key) });
  const op = await resolveVerifiedOperator(bearer, config, options(registry));
  assertSessionBoundOperator(op);
  assert.deepEqual(op.principal.projectIds, ["PVT"]);
  assert.equal(operatorConfig(op).writeEnabled, true);
  for (const secret of [record.accessCode, config.githubToken, bearer]) assert.equal(JSON.stringify(op).includes(secret), false);
  assert.throws(() => op.principal.permissions.push("bulk.apply"), TypeError);
  assert.throws(() => assertSessionBoundOperator({ ...op }), /OPERATOR_AUTH_REQUIRED/);
});
test("unversioned personal and legacy proofs preserve normal authentication but cannot bootstrap admin sessions", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const old = await resolveVerifiedOperator(await token({ scope: "projects:read" }), config, options(registry));
  assert.equal(operatorConfig(old).writeEnabled, false);
  assert.throws(() => assertSessionBoundOperator(old), /OPERATOR_REAUTH_REQUIRED/);
  const legacy = await resolveVerifiedOperator(await token({ sub: "gyuniverse-projects-team" }), config, options(registry));
  assert.equal(legacy.principal.role, "viewer"); assert.deepEqual(legacy.principal.permissions, ["project.read"]);
  assert.throws(() => assertSessionBoundOperator(legacy), /OPERATOR_REAUTH_REQUIRED/);
});
test("revalidation observes code rotation, identity removal, role reduction and source proof expiry", async (t) => {
  environment(t); let registry = new OAuthIdentityRegistry([record]);
  const opts = { registry: () => registry, teamStore: () => null, bindingKey: key };
  const op = await resolveVerifiedOperator(await token({ identityVersion: registry.credentialVersion(record.subject, key) }), config, opts);
  registry = new OAuthIdentityRegistry([{ ...record, role: "viewer", projectIds: ["PVT"] }]);
  const reduced = await revalidateVerifiedOperator(op, opts);
  assert.equal(reduced.principal.role, "viewer"); assert.deepEqual(reduced.principal.permissions, ["project.read"]);
  assert.throws(() => operatorConfig(op), /OPERATOR_AUTH_REQUIRED/);
  registry = new OAuthIdentityRegistry([{ ...record, accessCode: "rotated-synthetic-code" }]);
  await assert.rejects(() => revalidateVerifiedOperator(reduced, opts), /OPERATOR_IDENTITY_UNAVAILABLE/);
  const beforeRemoval = await resolveVerifiedOperator(await token({ identityVersion: registry.credentialVersion(record.subject, key) }), config, opts);
  registry = new OAuthIdentityRegistry([]);
  await assert.rejects(() => revalidateVerifiedOperator(beforeRemoval, opts), /OPERATOR_IDENTITY_UNAVAILABLE/);
  registry = new OAuthIdentityRegistry([record]);
  const expiring = await resolveVerifiedOperator(await token({ identityVersion: registry.credentialVersion(record.subject, key) }), config, opts);
  await assert.rejects(() => revalidateVerifiedOperator(expiring, { ...opts, now: () => expiring.proof.expiresAt }), /OPERATOR_AUTH_REQUIRED/);
});
test("current team capability intersection and unavailable ACL never fall back to the ENV admin role", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const bearer = await token({ identityVersion: registry.credentialVersion(record.subject, key) });
  const store = { getSnapshot: async () => ({ grants: [{ teamId: "team", resourceId: "resource", provider: "github_projects" as const,
    externalResourceId: "PVT", teamRole: "viewer" as const, grantRole: "admin" as const, permissions: null }] }) };
  const op = await resolveVerifiedOperator(bearer, config, { ...options(registry), teamStore: () => store });
  assert.deepEqual(op.principal.resourcePermissions!.PVT, ["project.read"]);
  await assert.rejects(() => resolveVerifiedOperator(bearer, config, { ...options(registry), teamStore: () => { throw new Error("private-ACL-error"); } }),
    (e: Error) => { assert.match(e.message, /TEAM_ACL_UNAVAILABLE/); assert.doesNotMatch(e.message, /private/); return true; });
});
test("managed binding is strict and missing/unavailable managed adapters cannot fall back to an ENV identity", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const credentialId = "12345678-1234-4123-8123-123456789abc", subject = "user:managed:" + credentialId;
  for (const extra of [{ sub: subject }, { credentialId }, { sub: subject, credentialId: "bad" }]) {
    await assert.rejects(async () => resolveVerifiedOperator(await token(extra), config, options(registry)), /OPERATOR_AUTH_REQUIRED/);
  }
  const bearer = await token({ sub: subject, credentialId });
  await assert.rejects(() => resolveVerifiedOperator(bearer, config, options(registry)), /OPERATOR_IDENTITY_UNAVAILABLE/);
  let active = true;
  const opts = { ...options(registry), managedPrincipal: async (sub: string, id: string) => {
    assert.equal(id, credentialId); return active ? principalForRole(sub, "viewer", { projectIds: ["PVT"] }) : null;
  } };
  const op = await resolveVerifiedOperator(bearer, config, opts); assertSessionBoundOperator(op);
  assert.equal(op.principal.role, "viewer"); active = false;
  await assert.rejects(() => revalidateVerifiedOperator(op, opts), /OPERATOR_IDENTITY_UNAVAILABLE/);
  await assert.rejects(() => resolveVerifiedOperator("not-a-signed-token", config, options(registry)), /OPERATOR_AUTH_REQUIRED/);
});
test("failed revalidation invalidates the old verified snapshot instead of allowing fallback", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const op = await resolveVerifiedOperator(await token({ identityVersion: registry.credentialVersion(record.subject, key) }), config, options(registry));
  await assert.rejects(() => revalidateVerifiedOperator(op, { ...options(registry), registry: () => new OAuthIdentityRegistry([]) }), /OPERATOR_IDENTITY_UNAVAILABLE/);
  assert.throws(() => operatorConfig(op), /OPERATOR_AUTH_REQUIRED/);
});
test("proof expiration during an asynchronous ACL lookup is rejected before returning an operator", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  let now = Math.floor(Date.now() / 1000); const expiresAt = now + 60;
  const bearer = await token({ exp: expiresAt, identityVersion: registry.credentialVersion(record.subject, key) });
  await assert.rejects(() => resolveVerifiedOperator(bearer, config, { ...options(registry), now: () => now,
    teamStore: () => ({ getSnapshot: async () => { now = expiresAt; return { grants: [] }; } }),
  }), /OPERATOR_AUTH_REQUIRED/);
});
test("refreshing server allowlists can narrow an operator but cannot widen its original ceiling", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const op = await resolveVerifiedOperator(await token({ identityVersion: registry.credentialVersion(record.subject, key) }), config, options(registry));
  const narrowed = await revalidateVerifiedOperator(op, { ...options(registry), currentConfig: () => ({ ...config, allowedProjectIds: [], writeEnabled: false }) });
  assert.deepEqual(narrowed.principal.projectIds, []); assert.equal(operatorConfig(narrowed).writeEnabled, false);
  const cannotWiden = await revalidateVerifiedOperator(narrowed, { ...options(registry), currentConfig: () => config });
  assert.deepEqual(cannotWiden.principal.projectIds, []); assert.equal(operatorConfig(cannotWiden).writeEnabled, false);
});
test("malformed managed principal responses are bounded failures rather than unchecked authorization data", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([record]);
  const credentialId = "12345678-1234-4123-8123-123456789abc", subject = "user:managed:" + credentialId;
  const bearer = await token({ sub: subject, credentialId });
  for (const principal of [
    { ...principalForRole(subject, "admin"), projectIds: "private-invalid-project-data" },
    { ...principalForRole(subject, "viewer"), permissions: ["project.read", "project.view.write"] },
    { ...principalForRole("different-subject", "admin"), projectIds: ["PVT"] },
  ]) await assert.rejects(() => resolveVerifiedOperator(bearer, config, { ...options(registry), managedPrincipal: async () => principal as never }),
    (e: Error) => { assert.match(e.message, /OPERATOR_IDENTITY_UNAVAILABLE/); assert.doesNotMatch(e.message, /private-invalid/); return true; });
});
test("token role/Project claims cannot replace current identity permissions and incorrect credential versions fail", async (t) => {
  environment(t); const registry = new OAuthIdentityRegistry([{ ...record, role: "viewer", projectIds: ["PVT"] }]);
  const bearer = await token({ identityVersion: registry.credentialVersion(record.subject, key), role: "admin", projectIds: ["OTHER"], permissions: ["project.view.write"] });
  const op = await resolveVerifiedOperator(bearer, config, options(registry));
  assert.equal(op.principal.role, "viewer"); assert.deepEqual(op.principal.permissions, ["project.read"]); assert.deepEqual(op.principal.projectIds, ["PVT"]);
  await assert.rejects(async () => resolveVerifiedOperator(await token({ identityVersion: "x".repeat(43) }), config, options(registry)), /OPERATOR_IDENTITY_UNAVAILABLE/);
});

test("default identity binding key uses the same trimmed signing secret as OAuth issuance",async(t)=>{
  environment(t);const registry=new OAuthIdentityRegistry([record]);const bearer=await token({identityVersion:registry.credentialVersion(record.subject,key)});
  process.env.MCP_OAUTH_SIGNING_SECRET="  "+key+"  ";
  const op=await resolveVerifiedOperator(bearer,config,{registry:()=>registry,teamStore:()=>null});assertSessionBoundOperator(op);
});
