import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { adminConsoleEnabled, ManagedCredentialStore, handleAdminRequest, managedPrincipal } from "./console.js";
import { managedTokenAuthorized } from "./managed-auth.js";

const ROOT="https://admin.example.test";
const stored:Array<{name:string;args:Record<string,unknown>}>=[];
const fetcher:typeof fetch=async(_url,init)=>{
  const name=String(_url).split("/").at(-1)??"";
  const args=JSON.parse(String(init?.body??"{}")) as Record<string,unknown>;
  stored.push({name,args});
  let out:unknown={ok:true};
  if(name==="mcp_admin_issue_credential")out={id:"12345678-1234-4123-8123-123456789abc"};
  if(name==="mcp_admin_resolve")out={
    subject:"user:managed:12345678-1234-4123-8123-123456789abc",
    credentialId:"12345678-1234-4123-8123-123456789abc",
    role:"viewer",projectIds:["PVT_CI"],displayName:"Tester",githubLogin:"test"
  };
  if(name==="mcp_admin_overview")out={users:[],credentials:[],audit:[]};
  return new Response(JSON.stringify(out),{status:200,headers:{"content-type":"application/json"}});
};
async function scoped(fn:()=>Promise<void>){
  const previous=new Map<string,string|undefined>();
  const env:Record<string,string>={
    GYP_ADMIN_CONSOLE_ENABLED:"true",VERCEL_ENV:"preview",
    GYP_ADMIN_SESSION_SECRET:"secure-session-key-synthetic-should-be-32-bytes",
    GYP_ADMIN_UI_PASSWORD:"secure-ui-password-synthetic-should-be-32-bytes",
    M12_SUPABASE_URL:"https://admin-db.example.test",
    M12_SUPABASE_SERVICE_ROLE_KEY:"sb_secret_synthetic_do_not_use"
  };
  for(const [key,value] of Object.entries(env)){previous.set(key,process.env[key]);process.env[key]=value;}
  stored.length=0;
  try{await fn();}finally{for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}
function post(path:string,body:unknown,headers:Record<string,string>={}){
 return new Request(ROOT+"/api/admin/v1/"+path,{method:"POST",headers:{"origin":ROOT,"content-type":"application/json",...headers},body:JSON.stringify(body)});
}
test("console never responds when flag is off or in Production",async()=>{
 await scoped(async()=>{
  process.env.VERCEL_ENV="production";
  assert.equal(adminConsoleEnabled(),false);
  assert.equal((await handleAdminRequest(post("session",{password:"x"}))).status,404);
 });
});
test("console sessions reject other origins, wrong password and CSRF",async()=>{
 await scoped(async()=>{
  const wrong=await handleAdminRequest(post("session",{password:"wrong"}),undefined,async()=>true);assert.equal(wrong.status,401);
  const foreign=new Request(ROOT+"/api/admin/v1/session",{method:"POST",headers:{"origin":"https://evil.example","content-type":"application/json"},body:JSON.stringify({password:process.env.GYP_ADMIN_UI_PASSWORD})});
  assert.equal((await handleAdminRequest(foreign)).status,403);
  const login=await handleAdminRequest(post("session",{password:process.env.GYP_ADMIN_UI_PASSWORD}),undefined,async()=>true);
  assert.equal(login.status,200);
  const limited=await handleAdminRequest(post("session",{password:process.env.GYP_ADMIN_UI_PASSWORD}),undefined,async()=>false);
  assert.equal(limited.status,429);
  assert.match(login.headers.get("set-cookie")??"",/HttpOnly; Secure; SameSite=Strict/);
  const auth=await login.json() as {csrf:string};
  const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const store=new ManagedCredentialStore(undefined,undefined,fetcher);
  const bad=await handleAdminRequest(post("credentials",{subject:"user:managed:12345678-1234-4123-8123-123456789abc"},{cookie}),store);
  assert.equal(bad.status,403);
  const valid=await handleAdminRequest(post("credentials",{subject:"user:managed:12345678-1234-4123-8123-123456789abc"},{cookie,"x-csrf-token":auth.csrf}),store);
  assert.equal(valid.status,201);
  const issued=await valid.json() as {id:string;secret:string};
  assert.match(issued.secret,/^gyp_[A-Za-z0-9_-]{43}$/);
  const op=stored.find(x=>x.name==="mcp_admin_issue_credential");
  assert.ok(op);
  assert.equal(op.args.p_secret_hash,createHash("sha256").update(issued.secret).digest("hex"));
  assert.equal(JSON.stringify(stored).includes(issued.secret),false);
 });
});
test("managed principal resolves to read-only permissions",async()=>{
 await scoped(async()=>{
  const store=new ManagedCredentialStore(undefined,undefined,fetcher);
  const issued=await store.issue("user:managed:12345678-1234-4123-8123-123456789abc");
  const found=await store.resolveCode(issued.secret);
  assert.ok(found);
  const principal=managedPrincipal(found);
  assert.equal(principal.role,"viewer");
  assert.deepEqual(principal.permissions,["project.read"]);
  assert.deepEqual(principal.projectIds,["PVT_CI"]);
  assert.equal(await managedTokenAuthorized("user:managed:no-credential",undefined),false);
  assert.equal(await managedTokenAuthorized("user:legacy:member",undefined),true);
 });
});
