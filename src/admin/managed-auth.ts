import { adminConsoleEnabled, ManagedCredentialStore, managedPrincipal } from "./console.js";
import type { AuthenticatedPrincipal } from "../core/identity/principal.js";

/** Managed credentials are opt-in and absent from Production. */
export async function managedSubjectForCode(code:string):Promise<{subject:string;credentialId:string}|null> {
  if(!adminConsoleEnabled()||!code.startsWith("gyp_"))return null;
  const found=await new ManagedCredentialStore().resolveCode(code);
  if(!found)return null;
  return {subject:found.subject,credentialId:found.credentialId};
}

/** One DB revocation check per authenticated request, including refresh tokens. */
export async function managedPrincipalForToken(
  subject:string,credentialId:string|undefined,
):Promise<AuthenticatedPrincipal|null> {
  if(!credentialId)return null;
  if(!adminConsoleEnabled())return null;
  const record=await new ManagedCredentialStore().resolveIssued(credentialId,subject);
  return record?managedPrincipal(record):null;
}

export async function managedTokenAuthorized(subject:string,credentialId:string|undefined):Promise<boolean> {
  if(!credentialId)return true; // Preserve legacy stateless identity tokens.
  if(!adminConsoleEnabled())return false;
  const record=await new ManagedCredentialStore().resolveIssued(credentialId,subject);
  return !!record;
}
