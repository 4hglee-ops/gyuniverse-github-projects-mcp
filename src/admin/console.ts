import { createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { principalForRole, type AuthenticatedPrincipal, type ProjectRole } from "../core/identity/principal.js";

const sessionCookie = "gyp_admin_session";
const sessionAge = 60 * 60 * 2;
type ManagedRecord = { subject:string;role:ProjectRole;projectIds:string[];displayName:string|null;githubLogin:string|null;credentialId:string };

export function adminConsoleEnabled():boolean {
  return process.env.GYP_ADMIN_CONSOLE_ENABLED === "true" && process.env.VERCEL_ENV !== "production";
}
function secureEnv(name:string):string {
  const value = process.env[name] ?? "";
  if (value.length < 32) throw new Error("ADMIN_CONFIG_UNAVAILABLE");
  return value;
}
function equal(a:string,b:string):boolean {
  const aa=Buffer.from(a),bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
function mac(payload:string):string {
  return createHmac("sha256",secureEnv("GYP_ADMIN_SESSION_SECRET")).update(payload).digest("base64url");
}
function getCookie(request:Request):string|null {
  const s=request.headers.get("cookie") ?? "";
  const p=s.split(";").map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+"="));
  return p?.slice(sessionCookie.length+1) ?? null;
}
function session(token:string):{exp:number;nonce:string}|null {
  const parts=token.split(".");
  if(parts.length!==2||!equal(mac(parts[0]),parts[1]))return null;
  try {
    const decoded=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
    if(typeof decoded.exp!=="number"||decoded.exp<=Date.now()/1000||
       typeof decoded.nonce!=="string"||decoded.nonce.length!==32)return null;
    return decoded;
  }catch{return null;}
}
function secureOrigin(req:Request):boolean {
  const url=new URL(req.url),origin=req.headers.get("origin");
  return url.protocol==="https:" && origin===url.origin;
}
function cookie(req:Request,token:string,maxAge=sessionAge):string {
  return sessionCookie+"="+token+"; Path=/api/admin/v1; HttpOnly; Secure; SameSite=Strict; Max-Age="+maxAge;
}
function json(body:unknown,status=200):Response {
  return Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
export class ManagedCredentialStore {
  constructor(
    private readonly origin=process.env.M12_SUPABASE_URL,
    private readonly key=process.env.M12_SUPABASE_SERVICE_ROLE_KEY,
    private readonly fetcher:typeof fetch=fetch,
  ) {
    if(!origin||!/^https:\/\/[a-z0-9.-]+\/?$/i.test(origin)||
       !key||key.startsWith("sb_publishable_"))throw new Error("ADMIN_DB_UNAVAILABLE");
  }
  private async rpc<T>(name:string,payload:Record<string,unknown>={}):Promise<T> {
    const headers:Record<string,string>={"apikey":this.key!,"Content-Type":"application/json","Cache-Control":"no-store"};
    if(!this.key!.startsWith("sb_secret_"))headers.Authorization="Bearer "+this.key;
    const res=await this.fetcher(this.origin!.replace(/\/$/,"")+"/rest/v1/rpc/"+name,{
      method:"POST",headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(5000),cache:"no-store",
    });
    if(!res.ok)throw new Error("ADMIN_DB_REQUEST_FAILED");
    return await res.json() as T;
  }
  overview(){return this.rpc<Record<string,unknown>>("mcp_admin_overview");}
  createUser(displayName:string,githubLogin:string,role:ProjectRole,projectIds:string[]){
    return this.rpc<{subject:string}>("mcp_admin_create_user",{
      p_display_name:displayName,p_github_login:githubLogin,p_role:role,p_project_ids:projectIds
    });
  }
  setUser(subject:string,role:ProjectRole,projectIds:string[],enabled:boolean){
    return this.rpc("mcp_admin_set_user",{p_subject:subject,p_role:role,p_project_ids:projectIds,p_enabled:enabled});
  }
  async issue(subject:string){
    const secret="gyp_"+randomBytes(32).toString("base64url");
    const hash=createHash("sha256").update(secret).digest("hex");
    const out=await this.rpc<{id:string}>("mcp_admin_issue_credential",{p_subject:subject,p_secret_hash:hash});
    return {id:out.id,secret}; // One-time response. Never persisted in plaintext.
  }
  revoke(id:string){return this.rpc("mcp_admin_revoke_credential",{p_id:id});}
  async resolveCode(code:string):Promise<ManagedRecord|null>{
    if(!/^gyp_[A-Za-z0-9_-]{43}$/.test(code))return null;
    return await this.rpc<ManagedRecord|null>("mcp_admin_resolve",{
      p_hash:createHash("sha256").update(code).digest("hex"),
    });
  }
  async resolveIssued(id:string,subject:string):Promise<ManagedRecord|null>{
    if(!/^[a-f0-9-]{36}$/i.test(id))return null;
    return await this.rpc<ManagedRecord|null>("mcp_admin_resolve",{p_id:id,p_subject:subject});
  }
}
export function managedPrincipal(record:ManagedRecord):AuthenticatedPrincipal {
  return principalForRole(record.subject,record.role,{
    projectIds:record.projectIds,displayName:record.displayName,githubLogin:record.githubLogin,source:"oauth",
  });
}

export async function handleAdminRequest(req:Request,store?:ManagedCredentialStore):Promise<Response> {
  if(!adminConsoleEnabled())return new Response("Not Found",{status:404});
  const url=new URL(req.url);
  if(!url.pathname.startsWith("/api/admin/v1/"))return new Response("Not Found",{status:404});
  try {
    if(req.method==="POST"&&!secureOrigin(req))return json({error:"ORIGIN_DENIED"},403);
    const path=url.pathname.slice("/api/admin/v1/".length);
    if(path==="session"&&req.method==="POST"){
      const data=await req.json() as {password?:unknown};
      const expected=secureEnv("GYP_ADMIN_UI_PASSWORD");
      const supplied=typeof data.password==="string"?data.password:"";
      if(!equal(supplied,expected))return json({error:"UNAUTHORIZED"},401);
      const body=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+sessionAge,nonce:randomBytes(24).toString("base64url")})).toString("base64url");
      const token=body+"."+mac(body);
      const response=json({authenticated:true,csrf:mac("csrf:"+token)});
      response.headers.set("Set-Cookie",cookie(req,token));
      return response;
    }
    const token=getCookie(req);
    const active=token?session(token):null;
    if(!active)return json({authenticated:false},401);
    if(path==="session"&&req.method==="GET")
      return json({authenticated:true,csrf:mac("csrf:"+token)});
    if(req.method==="POST"){
      if(!equal(req.headers.get("x-csrf-token")??"",mac("csrf:"+token)))return json({error:"CSRF_DENIED"},403);
      if(path==="logout"){
        const response=json({ok:true});
        response.headers.set("Set-Cookie",cookie(req,"",0));
        return response;
      }
    }
    const db=store??new ManagedCredentialStore();
    if(path==="overview"&&req.method==="GET")return json(await db.overview());
    if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
    const input=await req.json() as Record<string,unknown>;
    const subject=String(input.subject??"");
    const ids=input.projectIds;
    const role=input.role;
    const validRole=role==="viewer"||role==="member"||role==="admin";
    const validIds=Array.isArray(ids)&&ids.length>0&&ids.length<=30&&
      ids.every(x=>typeof x==="string"&&x.length>0&&x.length<=256)&&new Set(ids).size===ids.length;
    if(path==="users"){
      if(!validRole||!validIds||typeof input.displayName!=="string"||!input.displayName.trim()||input.displayName.length>100)
        return json({error:"INVALID_INPUT"},400);
      return json(await db.createUser(input.displayName,typeof input.githubLogin==="string"?input.githubLogin:"",role,ids),201);
    }
    if(path==="users/update"){
      if(!subject.startsWith("user:managed:")||!validRole||!validIds||typeof input.enabled!=="boolean")return json({error:"INVALID_INPUT"},400);
      await db.setUser(subject,role,ids,input.enabled);return json({ok:true});
    }
    if(path==="credentials"){
      if(!subject.startsWith("user:managed:"))return json({error:"INVALID_INPUT"},400);
      return json(await db.issue(subject),201);
    }
    if(path==="credentials/revoke"){
      const id=String(input.id??"");
      if(!/^[a-f0-9-]{36}$/i.test(id))return json({error:"INVALID_INPUT"},400);
      await db.revoke(id);return json({ok:true});
    }
    return json({error:"NOT_FOUND"},404);
  } catch {
    return json({error:"ADMIN_REQUEST_FAILED"},503);
  }
}
