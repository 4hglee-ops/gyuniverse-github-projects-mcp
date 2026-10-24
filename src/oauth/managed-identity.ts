import { z } from "zod";
import { managedCredentialHash, managedCredentialPattern } from "../admin/credential-issuer.js";
import type { ScopedDbTransport } from "../admin/scoped-db.js";
const binding=z.object({subject:z.string().startsWith("user:managed:").refine(s=>z.uuid().safeParse(s.slice(13)).success),credentialId:z.uuid(),expiresAt:z.number().int().positive().safe(),canWrite:z.boolean()}).strict();
export type ManagedBinding=z.infer<typeof binding>;
export interface ManagedOAuthRuntime {
 enabled?:boolean;
 lookupHash(hash:string):Promise<ManagedBinding|null>;
 current(subject:string,credentialId:string):Promise<ManagedBinding|null>;
}
export function managedOAuthEnabled(runtime?:ManagedOAuthRuntime){return runtime?.enabled===true&&process.env.VERCEL_ENV==="preview";}
export function validateManagedBinding(raw:unknown,subject?:string,credentialId?:string):ManagedBinding|null{
 if(raw===null)return null;const p=binding.parse(raw);if(p.expiresAt<=Math.floor(Date.now()/1000)||(subject&&p.subject!==subject)||(credentialId&&p.credentialId!==credentialId))throw Error("MANAGED_IDENTITY_UNAVAILABLE");return p;
}
/** Server injection only. Never accepts an actor/role from the OAuth form, never caches a binding. */
export class RpcManagedOAuth implements ManagedOAuthRuntime {
 readonly enabled:boolean;
 constructor(private readonly transport:ScopedDbTransport,options:{enabled?:boolean}={}){this.enabled=options.enabled===true;}
 private async query(args:Record<string,unknown>,subject?:string,id?:string){
  if(!managedOAuthEnabled(this))throw Error("MANAGED_OAUTH_DISABLED");
  try{return validateManagedBinding(await this.transport.rpc("mcp_admin_oauth_binding_v1",args),subject,id);}catch{throw Error("MANAGED_IDENTITY_UNAVAILABLE");}
 }
 lookupHash(hash:string){if(!/^[0-9a-f]{64}$/.test(hash))throw Error("MANAGED_IDENTITY_UNAVAILABLE");return this.query({p_secret_hash:hash});}
 current(subject:string,credentialId:string){if(!subject.startsWith("user:managed:")||!z.uuid().safeParse(credentialId).success)throw Error("MANAGED_IDENTITY_UNAVAILABLE");return this.query({p_subject:subject,p_credential_id:credentialId},subject,credentialId);}
}
export async function managedAccessCode(code:string,runtime?:ManagedOAuthRuntime){
 if(!managedCredentialPattern.test(code)||!managedOAuthEnabled(runtime))return null;
 return validateManagedBinding(await runtime!.lookupHash(managedCredentialHash(code)));
}
