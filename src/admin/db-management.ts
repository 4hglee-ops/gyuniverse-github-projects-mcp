import { z } from "zod";
import { managementInputSchemas, managedUserSchema, managedKeySchema, adminAuditSchema, type ScopedManagementRuntime } from "./managed-auth.js";
import { operatorPolicyDigest, scopedActorContext } from "./scoped-credential-rpc.js";
import { CredentialIssuer } from "./credential-issuer.js";
import type { ScopedDbTransport } from "./scoped-db.js";
import type { VerifiedOperator } from "../http/operator-auth.js";
const result = z.object({ operationId:z.uuid(),target:z.string().min(1).max(256),version:z.number().int().positive().safe(),replayed:z.boolean() }).strict();
const overview = z.object({ actorId:z.string().min(1).max(256),syntheticOnly:z.literal(false),projectIds:z.array(z.string().min(1).max(256)).max(100),canCreateUser:z.boolean(),
  users:z.array(managedUserSchema.extend({canUpdate:z.boolean(),canIssue:z.boolean()})).max(1000),
  credentials:z.array(managedKeySchema.extend({canRevoke:z.boolean()})).max(1000),audit:z.array(adminAuditSchema).max(1000) }).strict();
/** Command RPCs own the SQL transaction. Never implement the synthetic state callback over multiple HTTP requests. */
export function createDbManagementRuntime(options:{enabled?:boolean;transport:ScopedDbTransport;leaseFor:(operator:VerifiedOperator)=>Promise<{idHash:string;authEpoch:number}>}):ScopedManagementRuntime {
 return{persistence:"scoped-db",async handle(path,method,body,refresh){
  if(options.enabled!==true||process.env.VERCEL_ENV!=="preview")throw Error("ADMIN_DB_DISABLED: DB management is disabled.");
  if(method!=="GET"||path!=="overview"){
   if(method!=="POST"||!Object.hasOwn(managementInputSchemas,path))throw Error("ADMIN_ROUTE_NOT_FOUND: Unsupported management route.");
   const parsed=managementInputSchemas[path as keyof typeof managementInputSchemas].safeParse(body);if(!parsed.success)throw Error("ADMIN_INPUT_INVALID: Invalid management input.");body=parsed.data;
  }
  if(path==="credentials")return new CredentialIssuer({enabled:true,refresh,leaseFor:options.leaseFor,transport:options.transport}).issue(body);
  try{
   const first=await refresh(),digest=operatorPolicyDigest(first),lease=await options.leaseFor(first),current=await refresh();
   if(digest!==operatorPolicyDigest(current)||JSON.stringify(first.proof)!==JSON.stringify(current.proof))throw Error("changed");
   const p_actor=scopedActorContext(current,lease);
   if(path==="overview"){
    const out=overview.parse(await options.transport.rpc("mcp_admin_overview_v1",{p_actor}));
    if(out.actorId!==current.proof.subject)throw Error("invalid actor");return out;
   }
   const out=result.parse(await options.transport.rpc("mcp_admin_management_v1",{p_actor,p_request:{path,input:body}}));
   if(out.operationId!==(body as{operationId:string}).operationId)throw Error("wrong operation");return out;
  }catch{throw Error("ADMIN_DB_UNCONFIRMED: Management result was not confirmed. Inspect metadata before another operation.");}
 }};
}
