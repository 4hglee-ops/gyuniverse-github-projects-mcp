import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { MemoryAdminManagementStore, handleAdminManagement, type ManagedUser, type ManagementRuntime } from "./managed-auth.js";
import { AdminPolicy, type AdminOperation } from "./admin-policy.js";
import { resolveVerifiedOperator } from "../http/operator-auth.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { signEnvelope } from "../oauth/stateless.js";
const KEY = "synthetic-management-test-signing-key-never-used-externally", ROOT = "https://management.example.invalid";
const operations: AdminOperation[] = ["admin.users.read", "admin.users.write", "admin.credentials.read", "admin.credentials.issue", "admin.credentials.revoke", "admin.audit.read"];
const user = (projectIds = ["P1"]): ManagedUser => ({ subject: "user:managed:" + randomUUID(), displayName: "Synthetic user", githubLogin: "fixture", role: "viewer", projectIds, enabled: true, version: 1 });
async function setup(t: TestContext) {
  const env = { PUBLIC_BASE_URL: ROOT, MCP_OAUTH_SIGNING_SECRET: KEY }; const old = new Map(Object.keys(env).map((k) => [k, process.env[k]])); Object.assign(process.env, env);
  t.after(() => { for (const [k,v] of old) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const record = { subject: "user:manager", accessCode: "synthetic-management-code", role: "admin" as "admin" | "viewer", projectIds: ["P1"] };
  let registry = new OAuthIdentityRegistry([record]); const now = Math.floor(Date.now()/1000);
  const token = await signEnvelope("gypa", { typ: "access_token", sub: record.subject, scope: "projects:read projects:write", aud: ROOT + "/mcp", iat: now, exp: now+600, identityVersion: registry.credentialVersion(record.subject, KEY) });
  const config = { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["P1", "P2"], writeEnabled: false };
  const refresh = () => resolveVerifiedOperator(token, config, { registry: () => registry, bindingKey: KEY, teamStore: () => null });
  const visible = user(), mixed = user(["P1", "P2"]), outside = user(["P2"]);
  const store = new MemoryAdminManagementStore({ users: [visible,mixed,outside] });
  const policy = () => new AdminPolicy({ subject: record.subject, operations, projectIds: ["P1"], maxGrantRole: "member" }, true);
  const runtime: ManagementRuntime = { store, policy };
  const call = (path: string, body?: unknown) => handleAdminManagement(path, body === undefined ? "GET" : "POST", body, refresh, runtime);
  return { call, runtime, store, refresh, visible, mixed, outside, change: (role: "admin" | "viewer") => { registry = new OAuthIdentityRegistry([{ ...record, role }]); },
    access: (projectIds: string[], maxGrantRole: "viewer" | "member" | "admin" = "member") => {
      registry = new OAuthIdentityRegistry([{ ...record, projectIds }]);
      runtime.policy = () => new AdminPolicy({ subject: record.subject, operations, projectIds, maxGrantRole }, true);
    } };
}
test("management defaults deny; scoped overview excludes complete mixed/outside records and does not mint identities", async(t) => {
  const s = await setup(t); s.runtime.policy = () => new AdminPolicy(); await assert.rejects(() => s.call("overview"), /ADMIN_PERMISSION_DENIED/);
  s.runtime.policy = () => new AdminPolicy({ subject: "user:manager", operations, projectIds: ["P1"], maxGrantRole: "member" }, true);
  const out = await s.call("overview") as { users: ManagedUser[]; syntheticOnly: boolean };
  assert.deepEqual(out.users.map(u=>u.subject), [s.visible.subject]); assert.equal(out.syntheticOnly,true);
  const result = await s.call("users", { operationId: randomUUID(), displayName: "Pending only", githubLogin: "", role: "viewer", projectIds:["P1"] }) as { target: string };
  assert.match(result.target,/^user:managed:/); assert.equal((await s.store.read()).audit.length,1);
  // This metadata-only double has no OAuth resolve/ACL grant method; a created subject cannot become this actor.
  assert.equal("resolveCode" in s.store,false); assert.equal("grant" in s.store,false);
  assert.equal((await s.refresh()).principal.id,"user:manager");
});
test("client actor claims, role escalation, outside scope, and hiding old scope in an update are rejected",async(t)=>{
  const s=await setup(t), base={operationId:randomUUID(),displayName:"x",githubLogin:"",role:"viewer",projectIds:["P1"]};
  for(const patch of [{actorId:"user:manager"},{subject:s.visible.subject},{permissions:["project.write"]}]) await assert.rejects(()=>s.call("users",{...base,...patch}),/ADMIN_INPUT_INVALID/);
  for(const patch of [{role:"admin"},{projectIds:["P2"]},{projectIds:["P1","P2"]}]) await assert.rejects(()=>s.call("users",{...base,...patch}),/ADMIN_PERMISSION_DENIED/);
  await assert.rejects(()=>s.call("users/update",{operationId:randomUUID(),subject:s.mixed.subject,expectedVersion:1,role:"viewer",projectIds:["P1"],enabled:true}),/ADMIN_PERMISSION_DENIED/);
  assert.equal((await s.store.read()).audit.length,0);
});
test("metadata update uses expected version and rolls back rejected operations",async(t)=>{
  const s=await setup(t), body={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1,role:"member",projectIds:["P1"],enabled:false};
  await s.call("users/update",body);
  await assert.rejects(()=>s.call("users/update",{...body,operationId:randomUUID()}),/ADMIN_VERSION_CONFLICT/);
  const saved=await s.store.read(); assert.equal(saved.audit.length,1); assert.equal(saved.users[0]!.version,2); assert.equal(saved.users[0]!.enabled,false);
  await assert.rejects(()=>s.call("credentials",{operationId:randomUUID(),subject:s.visible.subject,expectedVersion:2}),/ADMIN_PERMISSION_DENIED/);
});
test("concurrent/replayed synthetic issuance creates one key, no recovered secret, and atomic audit",async(t)=>{
  const s=await setup(t), input={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1};
  const results=await Promise.all([s.call("credentials",input),s.call("credentials",input)]) as Array<{secret?:string;replayed:boolean}>;
  assert.equal(results.filter(r=>r.secret).length,1); assert.equal(results.filter(r=>r.replayed).length,1); assert.match(results[0]!.secret!,/^synthetic-only-/);
  const persisted=await s.store.read(); assert.equal(persisted.credentials.length,1); assert.equal(persisted.audit.length,1); assert.equal(JSON.stringify(persisted).includes(results[0]!.secret!),false);
  const replay=await s.call("credentials",input) as {secret?:string;secretUnavailable:boolean}; assert.equal(replay.secret,undefined); assert.equal(replay.secretUnavailable,true);
  await assert.rejects(()=>s.call("users/update",{...input,role:"viewer",projectIds:["P1"],enabled:true}),/ADMIN_OPERATION_CONFLICT/);
  await s.call("credentials/revoke",{operationId:randomUUID(),id:persisted.credentials[0]!.id,expectedVersion:1});
  assert.equal((await s.store.read()).credentials[0]!.revoked,true); assert.equal((await s.store.read()).audit[1]!.actorId,"user:manager");
});
test("queued writes recheck role after lock; policy lookup cannot outlive current role",async(t)=>{
  const s=await setup(t); let release!:()=>void; const lock=s.store.transaction(async()=>{await new Promise<void>(r=>{release=r;});});
  await new Promise(r=>setImmediate(r));
  const pending=s.call("credentials",{operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1}); s.change("viewer"); release(); await lock;
  await assert.rejects(()=>pending,/ADMIN_PERMISSION_DENIED/); assert.equal((await s.store.read()).credentials.length,0);
  s.change("admin"); const prior=s.runtime.policy; s.runtime.policy=async(op)=>{const policy=await prior(op);s.change("viewer");return policy;};
  await assert.rejects(()=>s.call("users",{operationId:randomUUID(),displayName:"denied",githubLogin:"",role:"viewer",projectIds:["P1"]}),/ADMIN_PERMISSION_DENIED/);
});
test("response loss leaves one committed operation; retry cannot issue another secret",async(t)=>{
  const s=await setup(t), input={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1}; const original=s.store.transaction.bind(s.store);
  let lost=true; s.store.transaction=async(work)=>{const out=await original(work);if(lost){lost=false;throw new Error("synthetic response lost");}return out;};
  await assert.rejects(()=>s.call("credentials",input),/synthetic response lost/);
  const replay=await s.call("credentials",input) as {secret?:string;replayed:boolean}; assert.equal(replay.replayed,true);assert.equal(replay.secret,undefined);assert.equal((await s.store.read()).credentials.length,1);
});
test("real/shared issuer and malformed adapter results remain unavailable",async(t)=>{
  const s=await setup(t); s.runtime.store={persistence:"shared",read:()=>s.store.read(),transaction:(work)=>s.store.transaction(work)};
  await assert.rejects(()=>s.call("credentials",{operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1}),/ADMIN_REAL_ISSUER_UNAVAILABLE/);
  assert.equal((await s.store.read()).credentials.length,0);
  s.runtime.store.read=async()=>({users:[],credentials:[{secret:"must-not-surface"}],audit:[],receipts:{}} as never);
  await assert.rejects(()=>s.call("overview"),(error:Error)=>{assert.match(error.message,/ADMIN_STORE_INVALID/);assert.doesNotMatch(error.message,/must-not-surface/);return true;});
});

test("malformed operation receipts cannot replay unexpected credential fields",async(t)=>{
  const s=await setup(t),operationId=randomUUID(),original=s.store.transaction.bind(s.store);
  s.store.transaction=(work)=>original(async(draft)=>{draft.receipts[operationId]={actorId:"user:manager",digest:"a".repeat(64),result:{operationId,target:s.visible.subject,version:1,secret:"private-invalid-receipt"}} as never;return work(draft);});
  await assert.rejects(()=>s.call("credentials",{operationId,subject:s.visible.subject,expectedVersion:1}),(error:Error)=>{assert.match(error.message,/ADMIN_STORE_INVALID/);assert.doesNotMatch(error.message,/private-invalid-receipt/);return true;});
  assert.equal((await s.store.read()).credentials.length,0);
});


test("issue replay checks the retained key scope after the user and actor scope narrow",async(t)=>{
  const s=await setup(t);s.access(["P1","P2"]);
  const input={operationId:randomUUID(),subject:s.mixed.subject,expectedVersion:1};await s.call("credentials",input);
  await s.store.transaction(async(draft)=>{const u=draft.users.find(u=>u.subject===s.mixed.subject)!;u.projectIds=["P1"];u.version++;});
  s.access(["P1"]);const before=await s.store.read();
  await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);assert.deepEqual(await s.store.read(),before);
});
test("issue replay retains the original receipt scope even when both key and user scopes narrow",async(t)=>{
  const s=await setup(t);s.access(["P1","P2"]);
  const input={operationId:randomUUID(),subject:s.mixed.subject,expectedVersion:1};await s.call("credentials",input);
  await s.store.transaction(async(draft)=>{draft.users.find(u=>u.subject===s.mixed.subject)!.projectIds=["P1"];draft.credentials[0]!.projectIds=["P1"];});
  s.access(["P1"]);await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
});
test("issue replay checks the current key Project and role ceiling independently of receipt and parent",async(t)=>{
  const s=await setup(t);s.access(["P1"],"viewer");
  const input={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1};await s.call("credentials",input);
  await s.store.transaction(async(draft)=>{draft.credentials[0]!.projectIds=["P1","P2"];});
  await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
  await s.store.transaction(async(draft)=>{draft.credentials[0]!.projectIds=["P1"];draft.credentials[0]!.role="member";});
  await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
});
test("update replay rechecks original role authority after target role and management ceiling shrink",async(t)=>{
  const s=await setup(t);await s.store.transaction(async(draft)=>{draft.users[0]!.role="member";});
  const input={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1,role:"viewer",projectIds:["P1"],enabled:true};
  await s.call("users/update",input);s.access(["P1"],"viewer");
  await assert.rejects(()=>s.call("users/update",input),/ADMIN_PERMISSION_DENIED/);
  s.access(["P1"]);const replay=await s.call("users/update",input) as {replayed:boolean;version:number};assert.equal(replay.replayed,true);assert.equal(replay.version,2);
});
test("issue replay denies disabled parents and revoked, absent or mismatched credentials",async(t)=>{
  const s=await setup(t),input={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1};await s.call("credentials",input);
  await s.store.transaction(async(draft)=>{draft.users[0]!.enabled=false;});await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
  await s.store.transaction(async(draft)=>{draft.users[0]!.enabled=true;draft.credentials[0]!.revoked=true;});await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
  await s.store.transaction(async(draft)=>{draft.credentials[0]!.revoked=false;draft.credentials[0]!.subject=s.outside.subject;});await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
  await s.store.transaction(async(draft)=>{draft.credentials=[];});await assert.rejects(()=>s.call("credentials",input),/ADMIN_PERMISSION_DENIED/);
});
test("normal create/update/issue/revoke repeats return metadata once with no additional changes or secret",async(t)=>{
  const s=await setup(t),create={operationId:randomUUID(),displayName:"Repeated",githubLogin:"",role:"viewer",projectIds:["P1"]};
  const created=await s.call("users",create) as {target:string};await s.call("users",create);
  const update={operationId:randomUUID(),subject:created.target,expectedVersion:1,role:"member",projectIds:["P1"],enabled:true};await s.call("users/update",update);await s.call("users/update",update);
  const issue={operationId:randomUUID(),subject:created.target,expectedVersion:2};const first=await s.call("credentials",issue) as {target:string;secret:string};assert.match(first.secret,/^synthetic-only-/);
  const repeated=await s.call("credentials",issue) as {secret?:string;replayed:boolean};assert.equal(repeated.secret,undefined);assert.equal(repeated.replayed,true);
  const revoke={operationId:randomUUID(),id:first.target,expectedVersion:1};await s.call("credentials/revoke",revoke);
  const replay=await s.call("credentials/revoke",revoke) as {replayed:boolean};assert.equal(replay.replayed,true);
  const state=await s.store.read();assert.equal(state.users.length,4);assert.equal(state.credentials.length,1);assert.equal(state.audit.length,4);assert.equal(Object.keys(state.receipts).length,4);
  assert.equal(JSON.stringify(state).includes(first.secret),false);
});
test("revoke replay retains the original parent scope and new operations still require the current key version",async(t)=>{
  const s=await setup(t);s.access(["P1","P2"]);
  const issued=await s.call("credentials",{operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1}) as {target:string};
  await s.store.transaction(async(draft)=>{draft.users[0]!.projectIds=["P1","P2"];});
  const revoke={operationId:randomUUID(),id:issued.target,expectedVersion:1};await s.call("credentials/revoke",revoke);
  await s.store.transaction(async(draft)=>{draft.users[0]!.projectIds=["P1"];});s.access(["P1"]);
  await assert.rejects(()=>s.call("credentials/revoke",revoke),/ADMIN_PERMISSION_DENIED/);
  s.access(["P1","P2"]);await assert.rejects(()=>s.call("credentials/revoke",{...revoke,operationId:randomUUID()}),/ADMIN_VERSION_CONFLICT/);
  assert.equal((await s.store.read()).audit.length,2);
});

test("user update replay preserves the original Project scope after a successful narrowing",async(t)=>{
  const s=await setup(t);s.access(["P1","P2"]);
  const input={operationId:randomUUID(),subject:s.mixed.subject,expectedVersion:1,role:"viewer",projectIds:["P1"],enabled:true};await s.call("users/update",input);
  s.access(["P1"]);await assert.rejects(()=>s.call("users/update",input),/ADMIN_PERMISSION_DENIED/);
  s.access(["P1","P2"]);const replay=await s.call("users/update",input) as {replayed:boolean};assert.equal(replay.replayed,true);assert.equal((await s.store.read()).audit.length,1);
});
test("receipts missing or corrupting the original authorization snapshot fail closed",async(t)=>{
  const s=await setup(t),input={operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1};await s.call("credentials",input);
  const transaction=s.store.transaction.bind(s.store);
  for(const snapshot of [undefined,[],[{projectIds:["P1","P1"],role:"viewer"}],[{projectIds:["P1"],role:"private-invalid-role"}]]){
    s.store.transaction=(work)=>transaction(async(draft)=>{const receipt=draft.receipts[input.operationId]!;
      if(snapshot===undefined)delete (receipt as {authorizationTargets?:unknown}).authorizationTargets;else receipt.authorizationTargets=snapshot as never;
      return work(draft);});
    await assert.rejects(()=>s.call("credentials",input),(e:Error)=>{assert.match(e.message,/ADMIN_STORE_INVALID/);assert.doesNotMatch(e.message,/private-invalid/);return true;});
  }
  assert.equal((await s.store.read()).credentials.length,1);assert.equal((await s.store.read()).audit.length,1);
});
test("authorized key revocation and its replay remain available for disabled parent metadata",async(t)=>{
  const s=await setup(t),issued=await s.call("credentials",{operationId:randomUUID(),subject:s.visible.subject,expectedVersion:1}) as {target:string};
  await s.store.transaction(async(draft)=>{draft.users[0]!.enabled=false;});
  const input={operationId:randomUUID(),id:issued.target,expectedVersion:1};await s.call("credentials/revoke",input);
  const replay=await s.call("credentials/revoke",input) as {replayed:boolean};assert.equal(replay.replayed,true);assert.equal((await s.store.read()).audit.length,2);
});
