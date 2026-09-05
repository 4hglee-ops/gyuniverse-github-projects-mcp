import type { AuthenticatedPrincipal, ProjectPermission } from "./principal.js";

export interface IdentityContext {
  authenticated: boolean;
  subject: string | null;
  displayName: string | null;
  githubLogin: string | null;
  role: string | null;
  permissions: ProjectPermission[];
  projectIds: string[];
  source: string | null;
}

/**
 * Returns only non-secret request identity metadata for operator validation.
 * Access codes, bearer tokens, signing secrets, and registry credentials are never exposed.
 */
export class IdentityContextService {
  constructor(private readonly principal: AuthenticatedPrincipal | null) {}

  getContext(): IdentityContext {
    if (!this.principal) {
      return {
        authenticated: false,
        subject: null,
        displayName: null,
        githubLogin: null,
        role: null,
        permissions: [],
        projectIds: [],
        source: null,
      };
    }

    return {
      authenticated: true,
      subject: this.principal.id,
      displayName: this.principal.displayName ?? null,
      githubLogin: this.principal.githubLogin ?? null,
      role: this.principal.role,
      permissions: [...this.principal.permissions],
      projectIds: [...this.principal.projectIds],
      source: this.principal.source,
    };
  }
}
