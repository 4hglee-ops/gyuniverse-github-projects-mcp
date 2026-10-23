import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../config.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import {
  configForRemoteScope,
  oauthChallengeScope,
  resolveRemotePrincipal,
} from "./remote-mcp.js";

const base: AppConfig = {
  githubToken: "test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_PROJECT"],
  writeEnabled: true,
};

async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    before.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("OAuth challenge is read-only by default", async () => {
  await withEnv({ MCP_OAUTH_WRITE_ENABLED: undefined }, () => {
    assert.equal(oauthChallengeScope(), "projects:read");
  });
});

test("OAuth challenge requests read and write when remote write OAuth is enabled", async () => {
  await withEnv({ MCP_OAUTH_WRITE_ENABLED: "true" }, () => {
    assert.equal(oauthChallengeScope(), "projects:read projects:write");
  });
});

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
  const principal = resolveRemotePrincipal("user:honggyu", base, registry);
  assert.equal(principal?.id, "user:honggyu");
  assert.equal(principal?.githubLogin, "4hglee-ops");
  assert.equal(principal?.role, "admin");
  assert.deepEqual(principal?.projectIds, ["PVT_PROJECT"]);
});

test("unknown individual subject fails closed", () => {
  const empty = new OAuthIdentityRegistry([]);
  assert.equal(resolveRemotePrincipal("user:unknown", base, empty), null);
});

test("legacy team subject is always read-only after individual identity migration", () => {
  const empty = new OAuthIdentityRegistry([]);
  const legacy = resolveRemotePrincipal("gyuniverse-projects-team", base, empty);

  assert.equal(legacy?.role, "viewer");
  assert.equal(legacy?.permissions.includes("project.read"), true);
  assert.equal(legacy?.permissions.includes("project.write"), false);
  assert.deepEqual(legacy?.projectIds, ["PVT_PROJECT"]);
});

test("public MCP resolves current bindings and revalidates before the final View mutation",{timeout:10000},async(t)=>{
  const {handleRemoteMcpRequest}=await import("./remote-mcp.js"),{signEnvelope}=await import("../oauth/stateless.js");
  const {GitHubGraphQlClient}=await import("../github/graphql-client.js"),{MemoryViewPlanStore}=await import("../core/views/view-plan-store.js");
  const values={PUBLIC_BASE_URL:"https://mcp-view.example.invalid",MCP_OAUTH_SIGNING_SECRET:"synthetic-mcp-view-key-never-issued-externally",MCP_LEGACY_JSON_TRANSPORT_ENABLED:"true"};
  const before=new Map(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);t.after(()=>{for(const[k,v]of before){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  const record={subject:"user:mcp-view",accessCode:"synthetic-mcp-view-code",role:"admin" as "admin"|"viewer",projectIds:["PVT"]};let registry=new OAuthIdentityRegistry([record]);
  const now=Math.floor(Date.now()/1000),token=await signEnvelope("gypa",{typ:"access_token",sub:record.subject,aud:values.PUBLIC_BASE_URL+"/mcp",scope:"projects:read projects:write",iat:now,exp:now+600,identityVersion:registry.credentialVersion(record.subject,values.MCP_OAUTH_SIGNING_SECRET)});
  let reads=0,mutations=0,revoke=false;const conn=(nodes:unknown[]=[])=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
  class Client extends GitHubGraphQlClient{override async request<T>(query:string,vars:Record<string,unknown>={}):Promise<T>{
    if(query.includes("mutation")){mutations++;throw Error("Unexpected synthetic mutation");}
    if(query.includes("query ProjectViews")&&revoke&&++reads===2)registry=new OAuthIdentityRegistry([{...record,role:"viewer"}]);
    return{repositoryOwner:{__typename:"Organization",projectV2:{id:"PVT",number:3,title:"Fixture",url:null,viewerCanUpdate:true,fields:conn([{id:"F",name:"Title",dataType:"TEXT"}]),views:conn([{id:"V",number:1,name:"Original",layout:"TABLE_LAYOUT",filter:null,configuration:{visibleFields:conn([{id:"F",name:"Title"}])},groupByFields:conn(),verticalGroupByFields:conn(),sortByFields:conn()}])}}}as T;
  }}
  const options={config:{githubToken:"synthetic-unused",allowedOwners:["fixture-org"],allowedProjectIds:["PVT"],writeEnabled:true},client:new Client("synthetic-unused"),viewPlanStore:new MemoryViewPlanStore(),auth:{registry:()=>registry,teamStore:()=>null,bindingKey:values.MCP_OAUTH_SIGNING_SECRET}};
  let id=0;const invoke=async(name:string,args:object)=>{const res=await handleRemoteMcpRequest(new Request(values.PUBLIC_BASE_URL+"/mcp",{method:"POST",headers:{"content-type":"application/json",accept:"application/json, text/event-stream",authorization:"Bearer "+token,"mcp-protocol-version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method:"tools/call",params:{name,arguments:args}})}),options);assert.equal(res.status,200);return await res.json() as {result:{isError?:boolean;content:Array<{text:string}>}};};
  const target={owner:"fixture-org",number:3};const preview=await invoke("preview_project_view_setup",{...target,update:{viewId:"V",changes:{name:"Must stop"}}});assert.notEqual(preview.result.isError,true);
  const plan=JSON.parse(preview.result.content[0]!.text);revoke=true;
  const applied=await invoke("update_project_view",{...target,planId:plan.planId,planDigest:plan.planDigest,approved:true});assert.notEqual(applied.result.isError,true);assert.equal(JSON.parse(applied.result.content[0]!.text).state,"failed");assert.equal(mutations,0);
  registry=new OAuthIdentityRegistry([{...record,accessCode:"rotated-synthetic-code"}]);
  const denied=await handleRemoteMcpRequest(new Request(values.PUBLIC_BASE_URL+"/mcp",{headers:{authorization:"Bearer "+token}}),options);assert.equal(denied.status,401);
  assert.equal((await handleRemoteMcpRequest(new Request(values.PUBLIC_BASE_URL+"/mcp",{headers:{cookie:"__Host-gyp_admin_session="+"x".repeat(43)}}),options)).status,401);
});
