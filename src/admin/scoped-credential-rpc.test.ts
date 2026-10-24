import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { ScopedCredentialRpc, type ScopedIssueOptions } from "./scoped-credential-rpc.js";
import { resolveVerifiedOperator } from "../http/operator-auth.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { signEnvelope } from "../oauth/stateless.js";

async function fixture(t: TestContext) {
  const env = { PUBLIC_BASE_URL: "https://scoped-rpc.example.invalid", MCP_OAUTH_SIGNING_SECRET: "synthetic-scoped-rpc-test-key-never-used-externally", VERCEL_ENV: "preview" };
  const old = new Map(Object.keys(env).map((k) => [k, process.env[k]])); Object.assign(process.env, env);
  t.after(() => { for (const [k,v] of old) { if(v===undefined)delete process.env[k];else process.env[k]=v; } });
  const record = { subject: "user:rpc-actor", accessCode: "synthetic-only-rpc-code", role: "admin" as "admin"|"viewer", projectIds: ["P1"] };
  let registry = new OAuthIdentityRegistry([record]); const scope = "projects:read projects:write";
  const now = Math.floor(Date.now()/1000), input = { operationId: randomUUID(), subject: "user:managed:"+randomUUID(), expectedVersion: 1 };
  let signed = await signEnvelope("gypa", { typ: "access_token", sub: record.subject, aud: env.PUBLIC_BASE_URL+"/mcp",scope,iat:now,exp:now+600,identityVersion:registry.credentialVersion(record.subject,env.MCP_OAUTH_SIGNING_SECRET) });
  let calls = 0, payload: unknown;
  const result = { operationId: input.operationId, subject: input.subject, credentialId: randomUUID(), userVersion: 1, keyVersion: 1, expiresAt: now+3600, replayed:false,candidateAccepted:true,secretUnavailable:false };
  const config = { githubToken:"synthetic-unused",allowedOwners:["fixture-org"],allowedProjectIds:["P1"],writeEnabled:false };
  const options: ScopedIssueOptions = { enabled:true,refresh:()=>resolveVerifiedOperator(signed,config,{registry:()=>registry,teamStore:()=>null}),leaseFor:async()=>({idHash:"a".repeat(64),authEpoch:1}),candidateHashFor:async()=>"b".repeat(64),transport:{rpc:async(_name,args)=>{calls++;payload=args;return result;}} };
  return {options,input,result, get calls(){return calls;}, get payload(){return payload;},changeRole:(role:"admin"|"viewer")=>{registry=new OAuthIdentityRegistry([{...record,role}]);}, rotateBinding:async()=>{registry=new OAuthIdentityRegistry([{...record,accessCode:"synthetic-rotated-rpc-code"}]);signed=await signEnvelope("gypa",{typ:"access_token",sub:record.subject,aud:env.PUBLIC_BASE_URL+"/mcp",scope,iat:now,exp:now+600,identityVersion:registry.credentialVersion(record.subject,env.MCP_OAUTH_SIGNING_SECRET)});} };
}
test("scoped RPC defaults disabled and rejects Production before any dependency runs",async(t)=>{
 const s=await fixture(t);delete s.options.enabled;await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_DISABLED/);
 s.options.enabled=true;process.env.VERCEL_ENV="production";await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_DISABLED/);assert.equal(s.calls,0);
});
test("scoped RPC rejects body actor/hash/authority injection before transport",async(t)=>{
 const s=await fixture(t);for(const patch of[{actorSubject:"other"},{candidateHash:"c".repeat(64)},{authEpoch:2},{projectIds:["OTHER"]},{leaseIdHash:"d".repeat(64)}])await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue({...s.input,...patch}),/ADMIN_RPC_INPUT_INVALID/);assert.equal(s.calls,0);
});
test("scoped RPC passes only server verified binding/ceiling and returns strict metadata, no raw credential",async(t)=>{
 const s=await fixture(t),out=await new ScopedCredentialRpc(s.options).issue(s.input);assert.equal(out.replayed,false);assert.equal(s.calls,1);
 const args=s.payload as {p_actor:{subject:string;projectIds:string[];projectPermissions:Record<string,string[]>};p_candidate_hash:string};assert.equal(args.p_actor.subject,"user:rpc-actor");assert.deepEqual(args.p_actor.projectIds,["P1"]);assert.ok(args.p_actor.projectPermissions.P1!.includes("project.write"));assert.equal(args.p_candidate_hash,"b".repeat(64));assert.doesNotMatch(JSON.stringify(out),/candidate_hash|identityVersion|synthetic-only-rpc-code|secret_hash/);
});
test("scoped RPC rechecks role after asynchronous candidate work without issuing",async(t)=>{
 const s=await fixture(t);s.options.candidateHashFor=async()=>{s.changeRole("viewer");return "b".repeat(64);};await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);assert.equal(s.calls,0);
});
test("scoped RPC accepts replay metadata only, never reinterprets it as fresh candidate success",async(t)=>{
 const s=await fixture(t);s.result.replayed=true;s.result.candidateAccepted=false;s.result.secretUnavailable=true;const out=await new ScopedCredentialRpc(s.options).issue(s.input);assert.equal(out.candidateAccepted,false);
 s.result.candidateAccepted=true;await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);
});
test("scoped RPC rejects wrong operation, unexpected secret fields, invalid leases and masks transport details",async(t)=>{
 const s=await fixture(t);s.options.transport.rpc=async()=>({...s.result,secret:"must-not-surface"});await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);
 s.options.transport.rpc=async()=>({...s.result,operationId:randomUUID()});await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);
 s.options.transport.rpc=async()=>{throw Error("private-db-url-and-payload");};await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),(e:Error)=>{assert.equal(e.message.startsWith("ADMIN_RPC_UNCONFIRMED:"),true);assert.doesNotMatch(e.message,/private-db/);return true;});
 s.options.leaseFor=async()=>({idHash:"bad",authEpoch:1});await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);
});

test("scoped RPC rejects a proof rebound while loading a lease before transport",async(t)=>{
 const s=await fixture(t);s.options.leaseFor=async()=>{await s.rotateBinding();return{idHash:"a".repeat(64),authEpoch:1};};await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);assert.equal(s.calls,0);
});
test("scoped RPC cannot use absent, zero-epoch or caller-extended lease metadata",async(t)=>{
 const s=await fixture(t);for(const lease of[undefined,{idHash:"a".repeat(64),authEpoch:0},{idHash:"a".repeat(64),authEpoch:1,subject:"user:other"}]){
  s.options.leaseFor=async()=>lease as never;await assert.rejects(()=>new ScopedCredentialRpc(s.options).issue(s.input),/ADMIN_RPC_UNCONFIRMED/);
 }assert.equal(s.calls,0);
});
