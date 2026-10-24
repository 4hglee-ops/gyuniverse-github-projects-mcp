import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { AdminDbLeaseBridge, ManagedDbResolver, PostgrestAdminTransport, type ScopedDbTransport } from "./scoped-db.js";
import { operatorPolicyDigest, ScopedCredentialRpc } from "./scoped-credential-rpc.js";
import { boundSessionRecord, MemoryAdminSessionStore } from "./session-store.js";
import { resolveVerifiedOperator } from "../http/operator-auth.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { signEnvelope } from "../oauth/stateless.js";


const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { ...init, headers: { "content-type": "application/json", ...init.headers } });
function preview(t: TestContext) { const old=process.env.VERCEL_ENV;process.env.VERCEL_ENV="preview";t.after(()=>{if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}); }
const options={url:"https://db.example.invalid",serviceKey:"sb_secret_synthetic-only-http-contract"};
test("PostgREST defaults disabled and Production denies before network",async(t)=>{
 preview(t);let calls=0;const fetcher:typeof fetch=async()=>{calls++;return json(null);};
 await assert.rejects(()=>new PostgrestAdminTransport({...options,fetcher}).rpc("mcp_admin_managed_principal_v1",{}),/ADMIN_DB_DISABLED/);
 process.env.VERCEL_ENV="production";await assert.rejects(()=>new PostgrestAdminTransport({...options,fetcher,enabled:true}).rpc("mcp_admin_managed_principal_v1",{}),/ADMIN_DB_DISABLED/);assert.equal(calls,0);
});
test("PostgREST fixed RPC POST uses server-only opaque apikey, bounded request and no redirect/cache/retry",async(t)=>{
 preview(t);let calls=0;const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(url,options.url+"/rest/v1/rpc/mcp_admin_managed_principal_v1");assert.equal(init?.method,"POST");const h=new Headers(init?.headers);assert.equal(h.get("apikey"),options.serviceKey);assert.equal(h.has("Authorization"),false);assert.equal(init?.redirect,"error");assert.equal(init?.cache,"no-store");assert.equal(init?.credentials,"omit");assert.ok(init?.signal);assert.deepEqual(JSON.parse(String(init?.body)),{p_subject:"synthetic"});return json(null);};
 const c=new PostgrestAdminTransport({...options,enabled:true,fetcher});assert.equal(await c.rpc("mcp_admin_managed_principal_v1",{p_subject:"synthetic"}),null);
 await assert.rejects(()=>c.rpc("other" as never,{}),/ADMIN_DB_UNCONFIRMED/);await assert.rejects(()=>c.rpc("mcp_admin_lease_v1",{oversize:"x".repeat(65537)}),/ADMIN_DB_UNCONFIRMED/);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(c),/synthetic-only-http-contract/);
});
test("PostgREST legacy service JWT uses Bearer; publishable/anon/unsafe endpoint configuration rejected",async(t)=>{
 preview(t);const serviceKey="synthetic."+Buffer.from(JSON.stringify({role:"service_role"})).toString("base64url")+".synthetic";
 const c=new PostgrestAdminTransport({...options,enabled:true,serviceKey,fetcher:async(_u,i)=>{assert.equal(new Headers(i?.headers).get("Authorization"),"Bearer "+serviceKey);return json(null);}});await c.rpc("mcp_admin_managed_principal_v1",{});
 for(const patch of[{url:"http://localhost"},{url:"https://user:pass@db.example.invalid"},{url:"https://db.example.invalid/other"},{url:"https://db.example.invalid/?q=1"},{serviceKey:"sb_publishable_synthetic"},{serviceKey:"synthetic."+Buffer.from(JSON.stringify({role:"anon"})).toString("base64url")+".synthetic"},{serviceKey:"sb_secret_bad\nheader"}])assert.throws(()=>new PostgrestAdminTransport({...options,...patch}),/ADMIN_DB_CONFIG_INVALID/);
});
test("PostgREST errors, redirects, malformed/oversize responses and deadline are masked with one attempt",async(t)=>{
 preview(t);for(const response of[()=>json({private:"do-not-return"},{status:403}),()=>new Response("redirect",{status:302,headers:{location:"https://elsewhere.invalid"}}),()=>new Response("invalid",{headers:{"content-type":"application/json"}}),()=>new Response("<html>",{headers:{"content-type":"text/html"}}),()=>json("x".repeat(65537)),()=>json(null,{headers:{"content-length":"70000"}}),()=>{throw Error("private-db-credential-url");}]){
  let calls=0;const c=new PostgrestAdminTransport({...options,enabled:true,fetcher:async()=>{calls++;return response();}});await assert.rejects(()=>c.rpc("mcp_admin_lease_v1",{}),(e:Error)=>{assert.match(e.message,/ADMIN_DB_UNCONFIRMED/);assert.doesNotMatch(e.message,/private|credential-url|elsewhere/);return true;});assert.equal(calls,1);
 }const hung=new PostgrestAdminTransport({...options,enabled:true,timeoutMs:10,fetcher:async()=>new Promise(()=>{})});await assert.rejects(()=>hung.rpc("mcp_admin_lease_v1",{}),/ADMIN_DB_UNCONFIRMED/);
});
const managed="user:managed:"+randomUUID(),credential=randomUUID();
const identity=()=>({id:managed,role:"viewer",permissions:["project.read"],projectIds:["P1"],source:"oauth",resourcePermissions:{P1:["project.read"]}});
test("managed DB resolver accepts current bounded metadata and null, with no credential material",async(t)=>{
 preview(t);
 let data:unknown=identity();const c=new ManagedDbResolver({rpc:async(n,args)=>{assert.equal(n,"mcp_admin_managed_principal_v1");assert.deepEqual(args,{p_subject:managed,p_credential_id:credential});return data;}},{enabled:true});assert.equal((await c.resolve(managed,credential))?.role,"viewer");data=null;assert.equal(await c.resolve(managed,credential),null);
});
test("managed DB resolver denies subject/capability/key injection, missing ceilings, malformed and unavailable replies",async(t)=>{
 preview(t);
 for(const data of[{...identity(),id:"user:managed:"+randomUUID()},{...identity(),permissions:["project.write"]},{...identity(),resourcePermissions:{}},{...identity(),resourcePermissions:{P1:["project.read","project.write"]}},{...identity(),secret_hash:"synthetic"},[identity()]])await assert.rejects(()=>new ManagedDbResolver({rpc:async()=>data},{enabled:true}).resolve(managed,credential),/ADMIN_DB_UNCONFIRMED/);
 const c=new ManagedDbResolver({rpc:async()=>{throw Error("private");}},{enabled:true});await assert.rejects(()=>c.resolve(managed,credential),/ADMIN_DB_UNCONFIRMED/);await assert.rejects(()=>c.resolve("user:other",credential),/ADMIN_DB_UNCONFIRMED/);
});
async function fixture(t:TestContext){
 preview(t);const env={PUBLIC_BASE_URL:"https://lease.example.invalid",MCP_OAUTH_SIGNING_SECRET:"synthetic-only-lease-unit-signing-value"},old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);t.after(()=>{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const record={subject:"user:lease-actor",accessCode:"synthetic-only-lease-code",role:"admin" as "admin"|"viewer",projectIds:["P1"]};let registry=new OAuthIdentityRegistry([record]);
 const now=Math.floor(Date.now()/1000),exp=now+600,proof=await signEnvelope("gypa",{typ:"access_token",sub:record.subject,aud:env.PUBLIC_BASE_URL+"/mcp",scope:"projects:read projects:write",iat:now,exp,identityVersion:registry.credentialVersion(record.subject,env.MCP_OAUTH_SIGNING_SECRET)});
 const config={githubToken:"synthetic-unused",allowedOwners:["fixture-org"],allowedProjectIds:["P1"],writeEnabled:false},auth={registry:()=>registry,teamStore:()=>null},operator=await resolveVerifiedOperator(proof,config,auth),sessions=new MemoryAdminSessionStore();const session=boundSessionRecord(operator,"a".repeat(64),"b".repeat(64));await sessions.create(session);
 let calls=0,epoch=1,replyPatch:Record<string,unknown>={},fault=false,afterCall:()=>Promise<void>=async()=>{};const rows=new Map<string,unknown>();
 const transport:ScopedDbTransport={rpc:async(_name,args)=>{calls++;if(fault)throw Error("private network failure");const a=args.p_actor as Record<string,unknown>,r=args.p_request as{action:string;expiresAt?:number};await afterCall();if(r.action==="revoke")return{idHash:a.leaseIdHash,revoked:true};if(r.action==="register")rows.set(String(a.leaseIdHash),{idHash:a.leaseIdHash,authEpoch:a.authEpoch,policyDigest:a.policyDigest,expiresAt:r.expiresAt});if(!rows.has(String(a.leaseIdHash)))throw Error("no lease");return{...rows.get(String(a.leaseIdHash)) as object,...replyPatch};}};
 const opts={enabled:true,revokeSession:(id:string)=>sessions.revoke(id),loadSession:()=>sessions.get(session.idHash),config:()=>config,auth,expectedEpoch:()=>epoch,transport};const bridge=new AdminDbLeaseBridge(opts);
 return{bridge,opts,operator,session,sessions,config,get calls(){return calls;},setEpoch:(n:number)=>{epoch=n;},setReply:(p:Record<string,unknown>)=>{replyPatch=p;},setFault:()=>{fault=true;},after:(f:()=>Promise<void>)=>{afterCall=f;},role:(role:"admin"|"viewer")=>{registry=new OAuthIdentityRegistry([{...record,role}]);},narrow:()=>{registry=new OAuthIdentityRegistry([{...record,projectIds:["OTHER"]}]);}};
}
test("server session -> current proof/ACL -> explicit lease, then issuance-compatible lookup; no auto enrollment",async(t)=>{
 const s=await fixture(t);await assert.rejects(()=>s.bridge.leaseFor(s.operator),/ADMIN_DB_UNCONFIRMED/);assert.equal(s.calls,1);assert.deepEqual(await s.bridge.register(),{idHash:s.session.idHash,authEpoch:1});assert.deepEqual(await s.bridge.leaseFor(await s.bridge.refresh()),{idHash:s.session.idHash,authEpoch:1});
});
test("DB lease bridge defaults disabled and rejects Production before session/transport",async(t)=>{
 const s=await fixture(t);s.opts.enabled=false;await assert.rejects(()=>new AdminDbLeaseBridge(s.opts).register(),/ADMIN_DB_DISABLED/);s.opts.enabled=true;process.env.VERCEL_ENV="production";await assert.rejects(()=>s.bridge.register(),/ADMIN_DB_DISABLED/);assert.equal(s.calls,0);
});
test("revoked/expired/changed session cannot register or lookup a lease",async(t)=>{
 const s=await fixture(t);await s.bridge.register();await s.sessions.revoke(s.session.idHash);await assert.rejects(()=>s.bridge.refresh(),/ADMIN_DB_UNCONFIRMED/);await assert.rejects(()=>s.bridge.leaseFor(s.operator),/ADMIN_DB_UNCONFIRMED/);assert.equal(s.calls,1);
 s.opts.loadSession=async()=>({...s.session,expiresAt:Math.floor(Date.now()/1000)-1});await assert.rejects(()=>new AdminDbLeaseBridge(s.opts).register(),/ADMIN_DB_UNCONFIRMED/);
});
test("role and scope narrowing block old operator lease lookup before DB request",async(t)=>{
 for(const change of["role","scope"]){const s=await fixture(t);if(change==="role")s.role("viewer");else s.narrow();await assert.rejects(()=>s.bridge.leaseFor(s.operator),/ADMIN_DB_UNCONFIRMED/);assert.equal(s.calls,0);}
});
test("epoch, digest, reference, expiry and unexpected lease fields fail closed after HTTP",async(t)=>{
 const s=await fixture(t);await s.bridge.register();for(const patch of[{authEpoch:2},{policyDigest:"c".repeat(64)},{idHash:"d".repeat(64)},{expiresAt:s.session.expiresAt+1},{extra:true}]){s.setReply(patch);await assert.rejects(()=>s.bridge.leaseFor(s.operator),/ADMIN_DB_UNCONFIRMED/);}
 s.setReply({});s.setEpoch(2);await assert.rejects(()=>s.bridge.leaseFor(s.operator),/ADMIN_DB_UNCONFIRMED/);
});
test("session revoke or role change during DB lease registration makes reply unusable",async(t)=>{
 for(const change of["revoke","role"]){const s=await fixture(t);s.after(async()=>{if(change==="revoke")await s.sessions.revoke(s.session.idHash);else s.role("viewer");});await assert.rejects(()=>s.bridge.register(),/ADMIN_DB_UNCONFIRMED/);}
});
test("unconfirmed DB revoke closes coordinator; no network fallback or automatic retry",async(t)=>{
 const s=await fixture(t);await s.bridge.register();s.setFault();await s.sessions.revoke(s.session.idHash);await assert.rejects(()=>s.bridge.revoke(s.session,1,operatorPolicyDigest(s.operator)),/ADMIN_DB_UNCONFIRMED/);const calls=s.calls;await assert.rejects(()=>s.bridge.refresh(),/ADMIN_DB_UNCONFIRMED/);assert.equal(s.calls,calls);
});
test("confirmed DB revoke works from captured server binding after role shrink and stays locally closed",async(t)=>{
 const s=await fixture(t);s.role("viewer");await s.sessions.revoke(s.session.idHash);await s.bridge.revoke(s.session,1,operatorPolicyDigest(s.operator));await assert.rejects(()=>s.bridge.refresh(),/ADMIN_DB_UNCONFIRMED/);
});
test("lease network failure prevents issuing credential and masks source errors",async(t)=>{
 const s=await fixture(t);s.setFault();let candidateCalls=0,issues=0;const issuer=new ScopedCredentialRpc({enabled:true,refresh:()=>s.bridge.refresh(),leaseFor:o=>s.bridge.leaseFor(o),candidateHashFor:async()=>{candidateCalls++;return"f".repeat(64);},transport:{rpc:async()=>{issues++;return{};}}});await assert.rejects(()=>issuer.issue({operationId:randomUUID(),subject:managed,expectedVersion:1}),/ADMIN_RPC_UNCONFIRMED/);assert.equal(candidateCalls,0);assert.equal(issues,0);assert.equal(s.calls,1);
});
test("policy digest is stable for set order and changes with current config ceilings",async(t)=>{
 const s=await fixture(t),old=operatorPolicyDigest(s.operator);s.config.allowedOwners.reverse();assert.equal(operatorPolicyDigest(s.operator),old);s.config.allowedProjectIds.push("P2");const current=await s.bridge.refresh();assert.notEqual(operatorPolicyDigest(current),old);assert.equal(s.operator.principal.projectIds.length,1);
});

test("managed resolver is disabled by default and in Production before transport",async(t)=>{
 preview(t);let calls=0;const transport:ScopedDbTransport={rpc:async()=>{calls++;return null;}};await assert.rejects(()=>new ManagedDbResolver(transport).resolve(managed,credential),/ADMIN_DB_DISABLED/);process.env.VERCEL_ENV="production";await assert.rejects(()=>new ManagedDbResolver(transport,{enabled:true}).resolve(managed,credential),/ADMIN_DB_DISABLED/);assert.equal(calls,0);
});
test("unconfirmed shared-session close still attempts DB revoke and cannot report logout success",async(t)=>{
 const s=await fixture(t);s.opts.revokeSession=async()=>{throw Error("private redis failure");};await assert.rejects(()=>s.bridge.revoke(s.session,1,operatorPolicyDigest(s.operator)),/ADMIN_DB_UNCONFIRMED/);assert.equal(s.calls,1);await assert.rejects(()=>s.bridge.refresh(),/ADMIN_DB_UNCONFIRMED/);
});
test("shared-session storage outage cannot fall back to a captured proof or a process-local session",async(t)=>{
 const s=await fixture(t);s.opts.loadSession=async()=>{throw Error("private store unavailable");};await assert.rejects(()=>s.bridge.register(),/ADMIN_DB_UNCONFIRMED/);await assert.rejects(()=>s.bridge.leaseFor(s.operator),/ADMIN_DB_UNCONFIRMED/);assert.equal(s.calls,0);
});

test("server config loader errors are masked before session or DB work",async(t)=>{
 const s=await fixture(t);s.opts.config=()=>{throw Error("private-backend-url-or-key");};await assert.rejects(()=>s.bridge.refresh(),(e:Error)=>{assert.match(e.message,/ADMIN_DB_UNCONFIRMED/);assert.doesNotMatch(e.message,/private-backend/);return true;});assert.equal(s.calls,0);
});
