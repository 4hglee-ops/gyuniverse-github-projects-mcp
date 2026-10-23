import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { handleAdminRequest } from "./console.js";
import { RedisAdminSessionStore, MemoryAdminSessionStore, type AdminSessionRedis } from "./session-store.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { signEnvelope } from "../oauth/stateless.js";
import { MemoryViewPlanStore } from "../core/views/view-plan-store.js";
import { AuditService } from "../core/audit/audit-service.js";
import { MemoryWriteAuditStore } from "../core/audit/audit-store.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { GitHubRestClient } from "../github/rest-client.js";
import { createHash } from "node:crypto";

const ROOT = "https://admin.example.invalid", KEY = "synthetic-admin-session-integration-key-never-used-externally";
class RedisDouble implements AdminSessionRedis {
  values = new Map<string, string>(); counters = new Map<string, number>();
  async get(k: string) { return this.values.get(k) ?? null; }
  async set(k: string, v: string, _o: { nx: true; ex: number }) { if (this.values.has(k)) return null; this.values.set(k, v); return "OK"; }
  async eval(script: string, keys: string[], args: Array<string | number>) {
    const k = keys[0]!;
    if (script.includes("ADMIN_LOGIN_SLOT")) { const n = (this.counters.get(k) ?? 0) + 1; this.counters.set(k, n); return n; }
    const raw = this.values.get(k); if (!raw) return 0; const p = JSON.parse(raw);
    if (p.idHash !== args[0]) return -1; if (p.revokedAt === null) { p.revokedAt = args[1]; this.values.set(k, JSON.stringify(p)); } return 1;
  }
}
async function fixture(t: TestContext) {
  const env = { PUBLIC_BASE_URL: ROOT, MCP_OAUTH_SIGNING_SECRET: KEY, GYP_ADMIN_CONSOLE_ENABLED: "true", GYP_ADMIN_SESSION_BRIDGE_ENABLED: "true", VERCEL_ENV: "preview" };
  const previous = new Map(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env); t.after(() => { for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  let now = Math.floor(Date.now() / 1000), name = "Original", mutations = 0;
  const user = { subject: "user:fixture-admin", accessCode: "synthetic-admin-session-access-code", role: "admin" as "admin" | "viewer", projectIds: ["PVT"] };
  let registry = new OAuthIdentityRegistry([user]);
  const redis = new RedisDouble(), store = new RedisAdminSessionStore(redis, () => now);
  const conn = (nodes: unknown[] = []) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  let onRead: (() => Promise<void>) | null = null;
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
      if (query.includes("query ProjectViewCatalog")) return { nodes: [{ id: "PVT", owner: { login: "fixture-org" }, number: 3, title: "Fixture", viewerCanUpdate: true }] } as T;
      if (query.includes("mutation")) { mutations++; name = (vars.input as { name: string }).name; return { updateProjectV2View: { projectV2View: { id: "V" } } } as T; }
      if (query.includes("query ProjectViews") && onRead) await onRead();
      return { repositoryOwner: { __typename: "Organization", projectV2: { id: vars.number === 2 ? "OTHER" : "PVT", number: vars.number, title: "Fixture", url: null, viewerCanUpdate: true,
        fields: conn([{ id: "F", name: "Title", dataType: "TEXT" }]), views: conn([{ id: "V", number: 1, name, layout: "TABLE_LAYOUT", filter: null,
          configuration: { visibleFields: conn([{ id: "F", name: "Title" }]) }, groupByFields: conn(), verticalGroupByFields: conn(), sortByFields: conn() }]) } } } as T;
    }
  }
  const options = { config: { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT", "OTHER"], writeEnabled: true },
    client: new Client("synthetic-unused"), sessionStore: store, viewPlanStore: new MemoryViewPlanStore(), auditService: new AuditService(200, new MemoryWriteAuditStore()),
    restClient: new GitHubRestClient("synthetic-unused", { fetchImplementation: async () => { throw new Error("Unexpected external REST request"); } }),
    auth: { registry: () => registry, teamStore: () => null, now: () => now, bindingKey: KEY } };
  const bearer = await signEnvelope("gypa", { typ: "access_token", sub: user.subject, aud: ROOT + "/mcp", scope: "projects:read projects:write", iat: now, exp: now + 3600,
    identityVersion: registry.credentialVersion(user.subject, KEY) });
  const call = (path: string, method = "GET", body?: unknown, cookie?: string, csrf?: string, auth?: string) => handleAdminRequest(new Request(ROOT + "/api/admin/v1/" + path, {
    method, headers: { ...(method === "POST" ? { origin: ROOT, "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}), ...(auth ? { authorization: "Bearer " + auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), options);
  const login = async (oldCookie?: string) => { const response = await call("session", "POST", {}, oldCookie, undefined, bearer); assert.equal(response.status, 200);
    const body = await response.json() as { data: { csrf: string } }; return { cookie: response.headers.get("set-cookie")!.split(";")[0]!, csrf: body.data.csrf, response }; };
  return { options, bearer, redis, store, call, login, user, get mutations() { return mutations; },
    change: (patch: Partial<typeof user>) => { registry = new OAuthIdentityRegistry([{ ...user, ...patch }]); },
    advance: (seconds: number) => { now += seconds; }, onRead: (fn: () => Promise<void>) => { onRead = fn; } };
}
test("admin session routes default off, refuse Production/foreign origins, and never enable management APIs", async (t) => {
  const s = await fixture(t); process.env.GYP_ADMIN_CONSOLE_ENABLED = "false";
  assert.equal((await s.call("session")).status, 404);
  process.env.GYP_ADMIN_CONSOLE_ENABLED = "true"; process.env.VERCEL_ENV = "production";
  assert.equal((await s.call("session")).status, 404); process.env.VERCEL_ENV = "preview";
  delete process.env.GYP_ADMIN_SESSION_BRIDGE_ENABLED; assert.equal((await s.call("session")).status, 404);
  process.env.GYP_ADMIN_SESSION_BRIDGE_ENABLED = "true";
  assert.equal((await handleAdminRequest(new Request(ROOT + "/api/admin/v1/session", { method: "POST", headers: { origin: "https://foreign.invalid" }, body: "{}" }), s.options)).status, 403);
  assert.equal((await s.call("users", "POST", {})).status, 404);
  assert.equal((await s.call("credentials", "POST", {})).status, 404);
  assert.equal(s.redis.values.size, 0);
  const noDurability = await handleAdminRequest(new Request(ROOT + "/api/admin/v1/session"), { ...s.options, sessionStore: new MemoryAdminSessionStore() });
  assert.equal(noDurability.status, 503);
});
test("personal proof creates a rotating host cookie, no bearer/secret storage, and CSRF-protected server logout", async (t) => {
  const s = await fixture(t), first = await s.login("__Host-gyp_admin_session=" + "x".repeat(43));
  assert.match(first.response.headers.get("set-cookie")!, /Path=\/; Secure; HttpOnly; SameSite=Strict/);
  assert.notEqual(first.cookie, "__Host-gyp_admin_session=" + "x".repeat(43));
  assert.equal((await s.call("session", "GET", undefined, first.cookie)).status, 200);
  const second = await s.login(first.cookie); assert.notEqual(first.cookie, second.cookie);
  assert.equal((await s.call("session", "GET", undefined, first.cookie)).status, 401);
  assert.equal((await s.call("logout", "POST", {}, second.cookie)).status, 403);
  assert.equal((await s.call("logout", "POST", {}, second.cookie, first.csrf)).status, 403);
  assert.equal((await s.call("session", "GET", undefined, second.cookie)).status, 200);
  const loggedOut = await s.call("logout", "POST", {}, second.cookie, second.csrf); assert.equal(loggedOut.status, 200); assert.match(loggedOut.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal((await s.call("session", "GET", undefined, second.cookie)).status, 401);
  for (const raw of s.redis.values.values()) { assert.equal(raw.includes(s.bearer), false); assert.equal(raw.includes(s.user.accessCode), false); assert.equal(raw.includes(second.csrf), false); }
});
test("session identity version, role and expiry are fresh; duplicate cookies or injected identity claims are refused", async (t) => {
  const s = await fixture(t), auth = await s.login();
  assert.equal((await s.call("session", "GET", undefined, auth.cookie + "; " + auth.cookie)).status, 401);
  assert.equal((await s.call("session", "POST", { subject: "attacker", role: "admin" }, undefined, undefined, s.bearer)).status, 400);
  s.change({ role: "viewer" }); assert.equal((await s.call("session", "GET", undefined, auth.cookie)).status, 403);
  s.change({ role: "admin" }); assert.equal((await s.call("session", "GET", undefined, auth.cookie)).status, 401);
  const second = await s.login();
  s.change({ role: "admin", accessCode: "rotated-synthetic-code" }); assert.equal((await s.call("session", "GET", undefined, second.cookie)).status, 403);
  s.change({ role: "admin" }); const third = await s.login();
  s.advance(901); assert.equal((await s.call("session", "GET", undefined, third.cookie)).status, 401);
});
test("session View adapter shares Core previews, explicit approval and at-most-once apply", async (t) => {
  const s = await fixture(t), auth = await s.login(), target = { owner: "fixture-org", number: 3 };
  const preview = await s.call("project/views/preview", "POST", { ...target, update: { viewId: "V", changes: { name: "Session update" } } }, auth.cookie, auth.csrf);
  assert.equal(preview.status, 200); const plan = (await preview.json() as { data: { planId: string; planDigest: string } }).data;
  const input = { ...target, planId: plan.planId, planDigest: plan.planDigest, approved: true };
  assert.equal((await s.call("write/views/update", "POST", input, auth.cookie)).status, 403); assert.equal(s.mutations, 0);
  const results = await Promise.all([s.call("write/views/update", "POST", input, auth.cookie, auth.csrf), s.call("write/views/update", "POST", input, auth.cookie, auth.csrf)]);
  assert.ok(results.every((r) => [200, 409].includes(r.status))); assert.equal(s.mutations, 1);
  await s.call("write/views/update", "POST", input, auth.cookie, auth.csrf); assert.equal(s.mutations, 1);
  const unknown = await s.call("project/views", "POST", { owner: "fixture-org", number: 2 }, auth.cookie, auth.csrf); assert.notEqual(unknown.status, 200);
});
test("revocation during final View pre-read prevents the mutation", async (t) => {
  const s = await fixture(t), auth = await s.login(), target = { owner: "fixture-org", number: 3 };
  const preview = await s.call("project/views/preview", "POST", { ...target, update: { viewId: "V", changes: { name: "Must stop" } } }, auth.cookie, auth.csrf);
  const plan = (await preview.json() as { data: { planId: string; planDigest: string } }).data;
  let reads = 0;
  s.onRead(async () => { if (++reads === 2) await s.store.revoke(createHash("sha256").update(auth.cookie.split("=")[1]!).digest("hex")); });
  const applied = await s.call("write/views/update", "POST", { ...target, planId: plan.planId, planDigest: plan.planDigest, approved: true }, auth.cookie, auth.csrf);
  assert.equal(applied.status, 200); assert.equal((await applied.json() as { data: { state: string } }).data.state, "failed"); assert.equal(s.mutations, 0);
});
test("login rate bounds and uncertain shared persistence never issue a successful cookie", async (t) => {
  const s = await fixture(t);
  for (let i = 0; i < 8; i++) assert.equal((await s.call("session", "POST", {}, undefined, undefined, s.bearer)).status, 200);
  const limited = await s.call("session", "POST", {}, undefined, undefined, s.bearer); assert.equal(limited.status, 429); assert.equal(limited.headers.has("set-cookie"), false);
  class Uncertain extends RedisDouble { override async set(k: string, v: string, o: { nx: true; ex: number }): Promise<"OK" | null> { await super.set(k, v, o); throw new Error("private-storage-response-lost"); } }
  s.options.sessionStore = new RedisAdminSessionStore(new Uncertain());
  const lost = await s.call("session", "POST", {}, undefined, undefined, s.bearer);
  assert.equal(lost.status, 503); assert.equal(lost.headers.has("set-cookie"), false);
  assert.doesNotMatch(await lost.text(), /private-storage/);
});

test("management HTTP requires its own gate/authority, CSRF and versions; synthetic issue/replay/logout remain scoped", async(t)=>{
  const s=await fixture(t), auth=await s.login(); const old=process.env.GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED;
  t.after(()=>{if(old===undefined)delete process.env.GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED;else process.env.GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED=old;});
  assert.equal((await s.call("overview")).status,404); process.env.GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED="true";
  assert.equal((await s.call("overview","GET",undefined,auth.cookie)).status,503);
  const {MemoryAdminManagementStore}=await import("./managed-auth.js"),{AdminPolicy}=await import("./admin-policy.js");
  const store=new MemoryAdminManagementStore(); const management={store,policy:()=>new AdminPolicy()};Object.assign(s.options,{management});
  assert.equal((await s.call("overview","GET",undefined,auth.cookie)).status,403);
  management.policy=()=>new AdminPolicy({subject:s.user.subject,operations:["admin.users.read","admin.users.write","admin.credentials.read","admin.credentials.issue","admin.credentials.revoke","admin.audit.read"],projectIds:["PVT"],maxGrantRole:"viewer"},true);
  const operationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",body={operationId,displayName:"Local only",githubLogin:"",role:"viewer",projectIds:["PVT"]};
  assert.equal((await s.call("users","POST",body,auth.cookie)).status,403);
  const created=await s.call("users","POST",body,auth.cookie,auth.csrf);assert.equal(created.status,200);const target=(await created.json() as {data:{target:string}}).data.target;
  assert.equal((await s.call("users","POST",{...body,role:"admin"},auth.cookie,auth.csrf)).status,403);
  const input={operationId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",subject:target,expectedVersion:1};
  const first=await s.call("credentials","POST",input,auth.cookie,auth.csrf);assert.equal(first.status,200);assert.match((await first.json() as {data:{secret:string}}).data.secret,/^synthetic-only-/);
  const replay=await s.call("credentials","POST",input,auth.cookie,auth.csrf);assert.equal((await replay.json() as {data:{secret?:string}}).data.secret,undefined);
  assert.equal((await store.read()).credentials.length,1);assert.equal((await store.read()).audit.length,2);
  const overview=await s.call("overview","GET",undefined,auth.cookie);assert.equal(overview.status,200);assert.doesNotMatch(await overview.text(),/synthetic-only-/);
  await s.call("logout","POST",{},auth.cookie,auth.csrf);assert.equal((await s.call("overview","GET",undefined,auth.cookie)).status,401);
});

test("session bootstrap revalidates after async persistence before confirming login",async(t)=>{
  const s=await fixture(t), create=s.store.create.bind(s.store);
  s.store.create=async(record)=>{await create(record);s.change({role:"viewer"});};
  const reduced=await s.call("session","POST",{},undefined,undefined,s.bearer);assert.equal(reduced.status,403);assert.match(reduced.headers.get("set-cookie")??"",/Max-Age=0/);assert.equal((await reduced.json() as {ok:boolean}).ok,false);
  assert.ok([...s.redis.values.values()].every(raw=>JSON.parse(raw).revokedAt!==null));
  s.change({role:"admin"});s.store.create=async(record)=>{await create(record);s.advance(3601);};
  const expired=await s.call("session","POST",{},undefined,undefined,s.bearer);assert.equal(expired.status,401);assert.equal((await expired.json() as {ok:boolean}).ok,false);assert.doesNotMatch(expired.headers.get("set-cookie")??"",/Max-Age=[1-9]/);
});
