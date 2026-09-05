import {
  type AuthenticatedPrincipal,
  type ProjectPermission,
  principalHasPermission,
} from "./principal.js";

export class IdentityPolicy {
  assertPermission(
    principal: AuthenticatedPrincipal | null | undefined,
    permission: ProjectPermission,
  ): void {
    if (!principal) {
      throw new Error("IDENTITY_REQUIRED: An authenticated principal is required for this operation.");
    }
    if (!principalHasPermission(principal, permission)) {
      throw new Error(
        `PERMISSION_DENIED: Principal '${principal.id}' lacks permission '${permission}'.`,
      );
    }
  }
}
