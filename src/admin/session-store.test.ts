import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { resolveVerifiedOperator } from "../http/operator-auth.js";
import { signEnvelope } from "../oauth/stateless.js";
import { boundSessionRecord, MemoryAdminSessionStore, RedisAdminSessionStore, requireSharedAdminSessions, type AdminSessionRedis } from "./session-store.js";

const key = "synthetic-session-store-signing-key-at-least-32-characters";
async function record(t: TestContext, lifetime = 3600) {
  const before = [process.env.PUBLIC_BASE_URL, process.env.MCP_OAUTH_SIGNING_SECRET];
  process.env.PUBLIC_BASE_URL = "https://session.example.invalid"; process.env.MCP_OAUTH_SIGNING_SECRET = key;
  t.after(() => { for (const [i, name] of ["PUBLIC_BASE_URL", "MCP_OAUTH_SIGNING_SECRET"].entries()) { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; } });
  const registry = new OAuthIdentityRegistry([{ subject: "user:admin", accessCode: "synthetic-session-code", role: "admin", projectIds: ["PVT"] }]);
  const now = Math.floor(Date.now() / 1000);
  const bearer = await signEnvelope("gypa", { typ: "access_token", sub: "user:admin", aud: "https://session.example.invalid/mcp", scope: "projects:read projects:write",
    iat: now, exp: now + lifetime, identityVersion: registry.credentialVersion("user:admin", key) });
  const operator = await resolveVerifiedOperator(bearer, { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT"], writeEnabled: true },
    { registry: () => registry, bindingKey: key, teamStore: () => null });
  return { operator, now, bearer, session: boundSessionRecord(operator, "1".repeat(64), "2".repeat(64), now) };
}
test("bound session metadata contains no bearer/code, never outlives the source proof and has a 15-minute ceiling", async (t) => {
  const s = await record(t), short = boundSessionRecord(s.operator, "3".repeat(64), "4".repeat(64), s.operator.proof.expiresAt - 20);
  assert.equal(s.session.expiresAt - s.session.createdAt, 900);
  assert.equal(short.expiresAt, s.operator.proof.expiresAt);
  assert.equal(short.expiresAt - short.createdAt, 20);
  const json = JSON.stringify(s.session); assert.equal(json.includes(s.bearer), false); assert.doesNotMatch(json, /synthetic-session-code|synthetic-unused/);
  assert.throws(() => boundSessionRecord({ ...s.operator }, "1".repeat(64), "2".repeat(64)), /OPERATOR_AUTH_REQUIRED/);
});
test("session claims are atomic, snapshots isolated, and logout revocation is idempotent", async (t) => {
  const s = await record(t); const store = new MemoryAdminSessionStore(() => s.now);
  const result = await Promise.allSettled([store.create(s.session), store.create(s.session)]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const read = (await store.get(s.session.idHash))!; read.proof.subject = "modified-copy";
  assert.equal((await store.get(s.session.idHash))!.proof.subject, "user:admin");
  assert.equal(await store.revoke(s.session.idHash), true); assert.equal(await store.get(s.session.idHash), null);
  assert.equal(await store.revoke(s.session.idHash), true); assert.equal(await store.revoke("3".repeat(64)), false);
});
test("expired/malformed sessions fail and deployed sessions cannot use the process-local contract double", async (t) => {
  const s = await record(t, 60); let now = s.now;
  const store = new MemoryAdminSessionStore(() => now); await store.create(s.session);
  now = s.session.expiresAt; assert.equal(await store.get(s.session.idHash), null);
  await assert.rejects(() => store.create({ ...s.session, idHash: "3".repeat(64) }), /ADMIN_SESSION_INVALID/);
  await assert.rejects(() => store.create({ ...s.session, unexpectedBearer: "must-not-be-stored" } as never));
  assert.throws(() => requireSharedAdminSessions(store, true), /ADMIN_SESSION_DURABILITY_REQUIRED/);
  assert.equal(requireSharedAdminSessions(store, false), store);
});
test("stored proofs reject missing read scope, mismatched identity source and widened lifetimes", async (t) => {
  const s = await record(t), store = new MemoryAdminSessionStore(() => s.now);
  for (const changed of [
    { proof: { ...s.session.proof, scope: "projects:write" } },
    { proof: { ...s.session.proof, subject: "gyuniverse-projects-team" } },
    { proof: { ...s.session.proof, source: "managed", subject: "user:admin", credentialId: "12345678-1234-4123-8123-123456789abc" } },
    { expiresAt: s.session.createdAt + 901 },
    { proof: { ...s.session.proof, expiresAt: s.session.expiresAt - 1 } },
  ]) await assert.rejects(() => store.create({ ...s.session, ...changed } as never), /ADMIN_SESSION_INVALID/);
});

/** Redis protocol double only: no real network, Redis TTL engine or Lua interpreter. */
class RedisDouble implements AdminSessionRedis {
  values = new Map<string, string>(); counters = new Map<string, number>(); ttl = new Map<string, number>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, options: { nx: true; ex: number }) {
    if (this.values.has(key)) return null; this.values.set(key, value); this.ttl.set(key, options.ex); return "OK";
  }
  async eval(script: string, keys: string[], args: Array<string | number>) {
    if (script.includes("ADMIN_LOGIN_SLOT")) { const n = (this.counters.get(keys[0]!) ?? 0) + 1; this.counters.set(keys[0]!, n); return n; }
    const raw = this.values.get(keys[0]!); if (!raw) return 0; const row = JSON.parse(raw);
    if (row.idHash !== args[0]) return -1; if (row.revokedAt === null) { row.revokedAt = args[1]; this.values.set(keys[0]!, JSON.stringify(row)); } return 1;
  }
}
test("shared adapter contract retains state across instances, NX claims, revocation and login bounds without touching other namespaces", async (t) => {
  const s = await record(t), redis = new RedisDouble(); let now = s.now;
  const first = new RedisAdminSessionStore(redis, () => now), second = new RedisAdminSessionStore(redis, () => now);
  const claims = await Promise.allSettled([first.create(s.session), second.create(s.session)]);
  assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(await second.get(s.session.idHash), s.session);
  assert.ok([...redis.values.keys()].every((k) => k.startsWith("gyuniverse:admin:v1:session:")));
  assert.equal([...redis.ttl.values()][0], 900);
  for (let i = 0; i < 8; i++) assert.equal(await first.takeLoginSlot("4".repeat(64)), true);
  assert.equal(await second.takeLoginSlot("4".repeat(64)), false);
  now += 600; assert.equal(await second.takeLoginSlot("4".repeat(64)), true);
  assert.equal(await second.revoke(s.session.idHash), true); assert.equal(await first.get(s.session.idHash), null);
  assert.equal(await first.revoke(s.session.idHash), true);
  assert.equal(requireSharedAdminSessions(first, true), first);
});
test("shared adapter rejects corrupted records and masks transport details", async (t) => {
  const s = await record(t), redis = new RedisDouble(), store = new RedisAdminSessionStore(redis, () => s.now);
  await store.create(s.session); const key = [...redis.values.keys()][0]!;
  redis.values.set(key, JSON.stringify({ ...s.session, idHash: "3".repeat(64) }));
  await assert.rejects(() => store.get(s.session.idHash), /ADMIN_SESSION_INVALID/);
  class Failed extends RedisDouble { override async get(): Promise<never> { throw new Error("private-transport-url"); } }
  await assert.rejects(() => new RedisAdminSessionStore(new Failed()).get(s.session.idHash),
    (e: Error) => { assert.match(e.message, /ADMIN_SESSION_STORE_UNAVAILABLE/); assert.doesNotMatch(e.message, /private/); return true; });
});
