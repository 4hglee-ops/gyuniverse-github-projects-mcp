import {
  type AuthenticatedPrincipal,
  type ProjectPermission,
  principalHasPermission,
  principalHasProject,
  principalHasProjectPermission,
} from "./principal.js";

export class IdentityPolicy {
  private bounded(value: string): string {
    return value.slice(0, 256);
  }

  assertPermission(
    principal: AuthenticatedPrincipal | null | undefined,
    permission: ProjectPermission,
  ): void {
    if (!principal) {
      throw new Error("IDENTITY_REQUIRED: An authenticated principal is required for this operation.");
    }
    if (!principalHasPermission(principal, permission)) {
      throw new Error(
        `PERMISSION_DENIED: Principal '${this.bounded(principal.id)}' lacks permission '${permission}'.`,
      );
    }
  }

  assertProjectPermission(principal: AuthenticatedPrincipal | null | undefined, projectId: string, permission: ProjectPermission): void {
    this.assertProjectMembership(principal, projectId);
    this.assertPermission(principal, permission);
    if (!principalHasProjectPermission(principal, projectId, permission)) {
      throw new Error("PERMISSION_DENIED: Principal lacks project-scoped capability.");
    }
  }

  assertProjectMembership(
    principal: AuthenticatedPrincipal | null | undefined,
    projectId: string,
  ): void {
    if (!principal) {
      throw new Error("IDENTITY_REQUIRED: An authenticated principal is required for Project access.");
    }
    if (!principalHasProject(principal, projectId)) {
      throw new Error(
        `PROJECT_MEMBERSHIP_DENIED: Principal '${this.bounded(principal.id)}' is not assigned to Project '${this.bounded(projectId)}'.`,
      );
    }
  }
}
