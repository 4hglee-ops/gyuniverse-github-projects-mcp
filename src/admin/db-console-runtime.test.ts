import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { createAdminDbConsoleRuntime } from "./db-console-runtime.js";
import { handleAdminRequest } from "./console.js";
import { MemoryAdminSessionStore, type AdminSessionStore, type AdminSessionRecord } from "./session-store.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { resolveVerifiedOperator, resolveSessionOperator } from "../http/operator-auth.js";
import { operatorPolicyDigest, ScopedCredentialRpc } from "./scoped-credential-rpc.js";
import { signEnvelope } from "../oauth/stateless.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import type { ScopedDbTransport } from "./scoped-db.js";

const ROOT="https://db-console.example.invalid",KEY="synthetic-only-console-db-binding-key-never-used-externally";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
async function fixture(t:TestContext){
 const env={PUBLIC_BASE_URL:ROOT,MCP_OAUTH_SIGNING_SECRET:KEY,VERCEL_ENV:"preview",GYP_ADMIN_CONSOLE_ENABLED:"true",GYP_ADMIN_SESSION_BRIDGE_ENABLED:"true"},old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);t.after(()=>{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const identity={subject:"user:db-console",accessCode:"synthetic-only-console-code",role:"admin" as "admin"|"viewer",projectIds:["P1"]};let registry=new OAuthIdentityRegistry([identity]),offset=0,epoch=1,fault="",redisFault=false,issued=0;
 const now=()=>Math.floor(Date.now()/1000)+offset,memory=new MemoryAdminSessionStore(now),records=new Map<string,AdminSessionRecord>();
 const store:AdminSessionStore={persistence:"shared",create:async s=>{records.set(s.idHash,structuredClone(s));await memory.create(s);},get:id=>memory.get(id),revoke:async id=>{if(redisFault)throw Error("synthetic shared close failed");return memory.revoke(id);},takeLoginSlot:id=>memory.takeLoginSlot(id)};
 const config={githubToken:"synthetic-unused",allowedOwners:["fixture-org"],allowedProjectIds:["P1"],writeEnabled:false},auth={registry:()=>registry,teamStore:()=>null,bindingKey:KEY},n=now();
 const bearer=await signEnvelope("gypa",{typ:"access_token",sub:identity.subject,aud:ROOT+"/mcp",scope:"projects:read projects:write",iat:n,exp:n+3600,identityVersion:registry.credentialVersion(identity.subject,KEY)}),digest=operatorPolicyDigest(await resolveVerifiedOperator(bearer,config,auth));
 const leases=new Map<string,{idHash:string;authEpoch:number;policyDigest:string;expiresAt:number;revoked?:boolean}>(),calls:string[]=[],receipts=new Map<string,unknown>();
 const transport:ScopedDbTransport={rpc:async(name,args)=>{const a=args.p_actor as Record<string,unknown>,r=args.p_request as Record<string,unknown>;calls.push(name+":"+r?.action);
  if(name==="mcp_admin_lease_v1"){
   const id=String(a.leaseIdHash);if(r.action==="revoke"){if(fault==="revokeFail")throw Error("synthetic DB close failed");const row=leases.get(id)??{idHash:id,authEpoch:Number(a.authEpoch),policyDigest:String(a.policyDigest),expiresAt:Number(r.expiresAt)};leases.set(id,{...row,revoked:true});if(fault==="revokeLost")throw Error("synthetic close reply lost");return{idHash:id,revoked:true};}
   if(a.authEpoch!==epoch||a.policyDigest!==digest)throw Error("denied manifest");
   if(r.action==="register"){if(!leases.has(id))leases.set(id,{idHash:id,authEpoch:epoch,policyDigest:digest,expiresAt:Number(r.expiresAt)});if(fault==="registerLost")throw Error("synthetic register reply lost");}
   const lease=leases.get(id);if(fault==="getFail"||!lease||lease.revoked||lease.expiresAt<=now())throw Error("lease denied");const{revoked:_,...out}=lease;return out;
  }
  if(name==="mcp_admin_issue_credential_scoped_v1"){
   const l=leases.get(String(a.leaseIdHash));if(!l||l.revoked||l.expiresAt<=now()||a.authEpoch!==epoch)throw Error("lease denied");const prior=receipts.get(String(r.operationId));if(prior)return{...prior as object,replayed:true,candidateAccepted:false,secretUnavailable:true};issued++;const result={operationId:r.operationId,subject:r.subject,userVersion:r.expectedVersion,keyVersion:1,credentialId:randomUUID(),expiresAt:now()+600,replayed:false,candidateAccepted:true,secretUnavailable:false};receipts.set(String(r.operationId),result);return result;
  }throw Error("unexpected resolver call");}};
 class Client extends GitHubGraphQlClient{override async request<T>():Promise<T>{return{nodes:[{id:"P1",owner:{login:"fixture-org"},number:3,title:"Synthetic",viewerCanUpdate:true}]}as T;}}
 const runtime=createAdminDbConsoleRuntime({enabled:true,runtime:{config,sessionStore:store,auth,client:new Client("synthetic-unused")},transport,expectedEpoch:()=>epoch});
 const call=(path:string,method="GET",body?:unknown,cookie?:string,csrf?:string,token?:string)=>handleAdminRequest(new Request(ROOT+"/api/admin/v1/"+path,{method,headers:{...(method==="POST"?{origin:ROOT,"content-type":"application/json"}:{}),...(cookie?{cookie}:{}),...(csrf?{"x-csrf-token":csrf}:{}),...(token?{authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtime);
 const login=async(oldCookie?:string)=>{const response=await call("session","POST",{},oldCookie,undefined,bearer);assert.equal(response.status,200);const data=(await response.json()).data;return{cookie:response.headers.get("set-cookie")!.split(";")[0]!,csrf:data.csrf};};
 return{runtime,transport,store,records,leases,calls,config,auth,bearer,call,login,get issued(){return issued;},fault:(v:string)=>{fault=v;},redisFault:()=>{redisFault=true;},epoch:()=>{epoch++;},role:()=>{registry=new OAuthIdentityRegistry([{...identity,role:"viewer"}]);},advance:(n:number)=>{offset+=n;}};
}
test("DB console factory defaults disabled and refuses Production before persistence or DB I/O",async(t)=>{
 const s=await fixture(t);const disabled=createAdminDbConsoleRuntime({runtime:{config:s.config,sessionStore:s.store,auth:s.auth},transport:s.transport,expectedEpoch:()=>1});const req=()=>new Request(ROOT+"/api/admin/v1/session",{method:"POST",headers:{origin:ROOT,authorization:"Bearer "+s.bearer},body:"{}"});assert.equal((await handleAdminRequest(req(),disabled)).status,503);assert.equal(s.calls.length,0);assert.equal(s.records.size,0);process.env.VERCEL_ENV="production";assert.equal((await s.call("session")).status,404);
});
test("connect rotates both shared sessions and DB leases, resume checks both, logout closes both",async(t)=>{
 const s=await fixture(t),first=await s.login(),second=await s.login(first.cookie);assert.notEqual(first.cookie,second.cookie);const rows=[...s.records.values()];assert.ok(rows.every(r=>r.dbLease?.authEpoch===1));assert.equal(s.leases.get(rows[0]!.idHash)?.revoked,true);assert.equal(await s.store.get(rows[0]!.idHash),null);assert.equal((await s.call("session","GET",undefined,second.cookie)).status,200);assert.equal((await s.call("logout","POST",{},second.cookie,second.csrf)).status,200);assert.equal(s.leases.get(rows[1]!.idHash)?.revoked,true);assert.equal((await s.call("identity","GET",undefined,second.cookie)).status,401);
});
test("connect rejects injected identity/epoch and missing CSRF cannot revoke a live DB session",async(t)=>{
 const s=await fixture(t);assert.equal((await s.call("session","POST",{authEpoch:1},undefined,undefined,s.bearer)).status,400);assert.equal(s.calls.length,0);const login=await s.login(),row=[...s.records.values()][0]!;assert.equal((await s.call("logout","POST",{},login.cookie)).status,403);assert.equal(s.leases.get(row.idHash)?.revoked,undefined);assert.equal((await s.call("session","GET",undefined,login.cookie)).status,200);
});
test("lost registration response clears cookie and closes newly stored session and DB lease without retry",async(t)=>{
 const s=await fixture(t);s.fault("registerLost");const res=await s.call("session","POST",{},undefined,undefined,s.bearer);assert.equal(res.status,503);assert.match(res.headers.get("set-cookie")!,/Max-Age=0/);assert.equal(s.calls.filter(x=>x.endsWith(":register")).length,1);const row=[...s.records.values()][0]!;assert.equal(await s.store.get(row.idHash),null);assert.equal(s.leases.get(row.idHash)?.revoked,true);
});
test("one-store logout failures stay unconfirmed and either closed store prevents session reuse",async(t)=>{
 for(const failure of["revokeFail","revokeLost","redis"]){const s=await fixture(t),login=await s.login(),row=[...s.records.values()][0]!;if(failure==="redis")s.redisFault();else s.fault(failure);const before=s.calls.length,res=await s.call("logout","POST",{},login.cookie,login.csrf);assert.equal(res.status,503);assert.match(res.headers.get("set-cookie")!,/Max-Age=0/);assert.equal(s.calls.slice(before).filter(x=>x.endsWith(":revoke")).length,1);assert.notEqual((await s.call("session","GET",undefined,login.cookie)).status,200);if(failure==="redis")assert.equal(s.leases.get(row.idHash)?.revoked,true);else assert.equal(await s.store.get(row.idHash),null);}
});
test("role loss and stale epoch close stored session/lease; expiry cannot resume",async(t)=>{
 for(const failure of["role","epoch","expiry"]){const s=await fixture(t),login=await s.login(),row=[...s.records.values()][0]!;if(failure==="role")s.role();else if(failure==="epoch")s.epoch();else s.advance(901);assert.notEqual((await s.call("session","GET",undefined,login.cookie)).status,200);assert.equal(await s.store.get(row.idHash),null);if(failure!=="expiry")assert.equal(s.leases.get(row.idHash)?.revoked,true);}
});
test("DB lookup outage cannot fall back to a valid shared session",async(t)=>{
 const s=await fixture(t),login=await s.login(),row=[...s.records.values()][0]!;s.fault("getFail");assert.equal((await s.call("identity","GET",undefined,login.cookie)).status,503);assert.equal(await s.store.get(row.idHash),null);assert.equal(s.leases.get(row.idHash)?.revoked,true);
});
test("route-created session/lease permits one scoped issue; logout stops captured issuer and replay",async(t)=>{
 const s=await fixture(t),login=await s.login(),row=[...s.records.values()][0]!;const refresh=async()=>{const op=await resolveSessionOperator(()=>s.store.get(row.idHash),s.config,s.auth);await s.runtime.dbBridge!.assertCurrent(row,s.store);return op;};const issuer=new ScopedCredentialRpc({enabled:true,refresh,leaseFor:async()=>({idHash:row.idHash,authEpoch:row.dbLease!.authEpoch}),candidateHashFor:async()=>hash("synthetic-candidate"),transport:s.transport});const req={operationId:randomUUID(),subject:"user:managed:"+randomUUID(),expectedVersion:1};await issuer.issue(req);assert.equal((await issuer.issue(req)).replayed,true);assert.equal(s.issued,1);await s.call("logout","POST",{},login.cookie,login.csrf);await assert.rejects(()=>issuer.issue(req),/ADMIN_RPC_UNCONFIRMED/);assert.equal(s.issued,1);
});
test("existing browser View client connects/resumes/logs out through DB-injected routes with a synthetic cookie jar",async(t)=>{
 const s=await fixture(t);const{createViewConsole}=await import(new URL("../../public/admin/views.js",import.meta.url).href);let cookie="";const fetcher=async(path:string,init:RequestInit={})=>{const headers=new Headers(init.headers);if(init.method==="POST")headers.set("origin",ROOT);if(cookie)headers.set("cookie",cookie);const res=await handleAdminRequest(new Request(ROOT+path,{...init,headers}),s.runtime);const next=res.headers.get("set-cookie");if(next)cookie=next.split(";")[0]!;return res;};const client=createViewConsole(fetcher);await client.connectSession(s.bearer);assert.equal(client.snapshot().transport,"session");assert.equal(client.snapshot().identity.subject,"user:db-console");await client.resumeSession();await client.logoutSession();assert.equal(client.snapshot().identity,null);assert.ok([...s.leases.values()].every(l=>l.revoked));
});
