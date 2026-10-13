#!/usr/bin/env node
// External HTTPS smoke for the protected develop Preview. No production, no writes.
// Vercel CLI 48.8+, curl, Node 22+, and Vercel login are required.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export const ORIGIN="https://gyuniverse-github-projects-mcp-git-develop-skn-34-2nd-5-team.vercel.app";
const REDIRECT="http://127.0.0.1:8765/preview-smoke";
const SYNTHETIC_ID="PVT_PREVIEW_PROBE_ONLY";
const MAX_BYTES=1_000_000;
const die=(stage,why)=>{throw new Error(stage+": "+why);};

export function parseCurlResponse(input){
  const source=String(input).replace(/\r\n/g,"\n");
  const matches=[...source.matchAll(/(?:^|\n)(HTTP\/(?:1\.[01]|2|3)\s+(\d{3})[^\n]*\n)/g)];
  for(let i=matches.length-1;i>=0;i--){
    const m=matches[i],start=m.index+(source[m.index]==="\n"?1:0),end=source.indexOf("\n\n",start);
    if(end<0)continue;
    const lines=source.slice(start,end).split("\n"),headers=new Map();
    for(const line of lines.slice(1)){
      const sep=line.indexOf(":");if(sep>0)headers.set(line.slice(0,sep).trim().toLowerCase(),line.slice(sep+1).trim());
    }
    return {status:Number(m[2]),headers,body:source.slice(end+2)};
  }
  die("HTTP","could not parse Vercel CLI curl output");
}

/**
 * Resolve the JS entry point behind the npm-installed Windows vercel.cmd shim.
 *
 * Calling Node directly avoids cmd.exe argument interpretation (DEP0190
 * warnings and broken quoting). In particular, bearer headers are passed as
 * distinct process arguments, not through a shell.
 */
export function resolveWindowsVercelEntrypoint(whereOutput, exists = existsSync) {
  for (const item of String(whereOutput).split(/\r?\n/)) {
    const shim = item.trim().replace(/^"|"$/g, "");
    if (!/\.cmd$/i.test(shim)) continue;
    const candidate = win32.join(win32.dirname(shim),
      "node_modules", "vercel", "dist", "vc.js");
    if (exists(candidate)) return candidate;
  }
  die("Vercel CLI", "npm-installed vercel.cmd / node_modules/vercel/dist/vc.js not found. Run npm.cmd install -g vercel");
}

function spawnVercelCurl(args) {
  const options = { shell: false, stdio: ["pipe","pipe","pipe"], windowsHide: true };
  if (process.platform !== "win32") return spawn("vercel", args, options);
  const lookup = spawnSync("where.exe", ["vercel.cmd"], {
    encoding: "utf8", windowsHide: true, timeout: 3000, maxBuffer: 16_384
  });
  if (lookup.error || lookup.status !== 0) {
    die("Vercel CLI", "vercel.cmd not found on PATH; run npm.cmd install -g vercel");
  }
  const entrypoint = resolveWindowsVercelEntrypoint(lookup.stdout);
  return spawn(process.execPath, [entrypoint, ...args], options);
}

async function http(path,method="GET",headers={},body){
  if(!path.startsWith("/"))die("target","must stay on Preview host");
  const args=["curl",ORIGIN+path,"--silent","--show-error","--include","--max-time","20","--request",method];
  for(const [k,v] of Object.entries(headers))args.push("--header",k+": "+v);
  if(body!==undefined)args.push("--data-binary","@-");
  return await new Promise((ok,no)=>{
    const started=Date.now();
    const child=spawnVercelCurl(args);
    let stdout="",failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill();},35000);
    child.on("error",()=>{failed=true;no(new Error("Vercel CLI unavailable; install and run vercel login"));});
    child.stdout.setEncoding("utf8");
    child.stdout.on("data",chunk=>{stdout+=chunk;if(Buffer.byteLength(stdout)>MAX_BYTES){failed=true;child.kill();}});
    // Deliberately do not print stderr, HTTP bodies, bearer tokens or authorization codes.
    child.stderr.resume();
    child.on("close",code=>{
      clearTimeout(timer);
      if(failed||code!==0){no(new Error("vercel curl failed (exit "+code+"); check login/deployment protection"));return;}
      try{ok({...parseCurlResponse(stdout),elapsedMs:Date.now()-started});}
      catch{no(new Error("vercel curl returned an unparseable HTTP response"));}
    });
    child.stdin.on("error",()=>{});
    child.stdin.end(body??"");
  });
}
const form=fields=>new URLSearchParams(fields).toString();
const status=(name,r,expected)=>{if(r.status!==expected)die(name,"HTTP "+r.status+", expected "+expected);return r;};
const json=(name,r)=>{try{return JSON.parse(r.body)}catch{die(name,"invalid JSON body");}};
function show(name,r){
  console.log("[PASS] "+name+" | "+r.status+" | "+
    (r.headers.get("content-type")??"").split(";")[0]+" | "+r.elapsedMs+" ms");
}
function rpc(name,response){
  status(name,response,200);
  if(!(response.headers.get("content-type")??"").includes("application/json"))die(name,"not JSON (legacy SSE still active?)");
  const data=json(name,response);
  if(data.jsonrpc!=="2.0"||!data.result||data.error)die(name,"invalid JSON-RPC result");
  show(name,response);
  return data.result;
}
export async function main(){
  console.log("External MCP Preview smoke: develop only / no GitHub writes");
  const health=status("health",await http("/health"),200);
  if(json("health",health).ok!==true)die("health","service unhealthy");
  show("health",health);
  const challenge=status("MCP challenge",await http("/mcp"),401);
  if(!(challenge.headers.get("www-authenticate")??"").includes("resource_metadata="))
    die("MCP challenge","Vercel protection still blocks the MCP OAuth challenge");
  show("MCP unauthenticated challenge",challenge);
  const resource=status("resource metadata",await http("/.well-known/oauth-protected-resource"),200);
  if(json("resource metadata",resource).resource!==ORIGIN+"/mcp")die("resource","audience mismatch");
  show("OAuth resource metadata",resource);
  const issuer=status("issuer",await http("/.well-known/oauth-authorization-server"),200);
  if(json("issuer",issuer).issuer!==ORIGIN)die("issuer","issuer mismatch");
  show("OAuth issuer",issuer);
  const accessCode=process.env.GYP_PREVIEW_ACCESS_CODE;
  if(!accessCode){
    console.log("[WAIT] Set GYP_PREVIEW_ACCESS_CODE with Preview synthetic Viewer code for full PKCE/MCP verification.");
    console.log("Never use Production, admin or team-wide access credentials.");
    return;
  }
  const verifier=randomBytes(48).toString("base64url");
  const challengeHash=createHash("sha256").update(verifier).digest("base64url");
  const state=randomBytes(16).toString("base64url");
  const reg=status("registration",await http("/oauth/register","POST",
    {"Content-Type":"application/json"},JSON.stringify({
      client_name:"Gyuniverse Preview external smoke",redirect_uris:[REDIRECT],
      token_endpoint_auth_method:"none",response_types:["code"],grant_types:["authorization_code"]
    })),201);
  const clientId=json("registration",reg).client_id;
  if(typeof clientId!=="string"||!clientId.startsWith("gyprc."))die("registration","invalid client");
  show("OAuth registration",reg);
  const authorize=status("authorize",await http("/oauth/authorize","POST",
    {"Content-Type":"application/x-www-form-urlencoded"},form({
      response_type:"code",client_id:clientId,redirect_uri:REDIRECT,state,
      code_challenge:challengeHash,code_challenge_method:"S256",
      resource:ORIGIN+"/mcp",scope:"projects:read",access_code:accessCode
    })),303);
  const location=authorize.headers.get("location");
  if(!location)die("authorize","Location missing (synthetic code may be invalid)");
  const redirect=new URL(location);
  if(redirect.origin!==new URL(REDIRECT).origin||redirect.searchParams.get("state")!==state)
    die("authorize","redirect origin/state mismatch");
  const code=redirect.searchParams.get("code");
  if(!code)die("authorize","authorization code missing");
  show("OAuth authorization",authorize);
  const tokens=status("token",await http("/oauth/token","POST",
    {"Content-Type":"application/x-www-form-urlencoded"},form({
      grant_type:"authorization_code",code,client_id:clientId,redirect_uri:REDIRECT,
      code_verifier:verifier,resource:ORIGIN+"/mcp"
    })),200);
  const bearer=json("token",tokens).access_token;
  if(typeof bearer!=="string"||!bearer.startsWith("gypa."))die("token","missing access token");
  show("OAuth PKCE exchange",tokens);
  const call=async(name,id,method,params,more={})=>{
    const result=await http("/mcp","POST",{
      Authorization:"Bearer "+bearer,"Content-Type":"application/json",
      Accept:"application/json, text/event-stream",...more
    },JSON.stringify({jsonrpc:"2.0",id,method,params}));
    return rpc(name,result);
  };
  await call("legacy initialize",1,"initialize",{
    protocolVersion:"2025-06-18",capabilities:{},
    clientInfo:{name:"gyuniverse-preview-external-smoke",version:"1.0"}
  });
  const tools=await call("legacy tools/list",2,"tools/list",{});
  if(!Array.isArray(tools.tools)||!tools.tools.some(t=>t.name==="get_identity_context"))
    die("tools/list","identity tool missing");
  const out=await call("legacy tools/call identity",3,"tools/call",{
    name:"get_identity_context",arguments:{}
  });
  let identity;
  try{identity=JSON.parse(out.content?.find(c=>c.type==="text")?.text??"");}
  catch{die("identity","invalid identity result");}
  if(identity.authenticated!==true||identity.role!=="viewer"||
    identity.projectIds?.length!==1||identity.projectIds[0]!==SYNTHETIC_ID)
    die("identity","non-synthetic Viewer; refusing further tests");
  const version="2026-07-28";
  await call("modern tools/list",4,"tools/list",{
    _meta:{
      "io.modelcontextprotocol/protocolVersion":version,
      "io.modelcontextprotocol/clientInfo":{name:"gyuniverse-preview-external-smoke",version:"1.0"},
      "io.modelcontextprotocol/clientCapabilities":{}
    }
  },{"MCP-Protocol-Version":version,"Mcp-Method":"tools/list"});
  console.log("[PASS] External HTTPS + protected Preview + PKCE + legacy JSON + modern MCP.");
  console.log("No real GitHub Project or Issue was read or modified.");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error("[FAIL] "+e.message);process.exitCode=1;});
