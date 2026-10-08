import {
  permissionsForRole,
  PROJECT_PERMISSIONS,
  type AuthenticatedPrincipal,
  type ProjectPermission,
  type ProjectRole,
} from "../identity/principal.js";

export type TeamProvider = "github_projects" | "jira";

/**
 * Access rows produced by the private M12 database RPC.
 *
 * An external resource is scoped to a team and connection. These rows are NOT
 * authentication credentials and MUST NOT contain secrets or access codes.
 */
export interface TeamResourceGrant {
  teamId: string;
  resourceId: string;
  provider: TeamProvider;
  externalResourceId: string;
  teamRole: ProjectRole;
  grantRole: ProjectRole;
  /** null means the grant role defaults; [] explicitly denies everything. */
  permissions: ProjectPermission[] | null;
}

export interface TeamAccessSnapshot {
  grants: TeamResourceGrant[];
}

const roles: readonly ProjectRole[] = ["viewer", "member", "admin"];
const supported = new Set<ProjectPermission>(PROJECT_PERMISSIONS);

function accessPermissions(row: TeamResourceGrant): ProjectPermission[] {
  if (!roles.includes(row.teamRole) || !roles.includes(row.grantRole)) {
    throw new Error("TEAM_ACL_INVALID: Unrecognized team or resource role.");
  }
  const team = new Set(permissionsForRole(row.teamRole));
  const granted = new Set(permissionsForRole(row.grantRole));
  const requested = row.permissions ?? [...granted];
  if (!Array.isArray(requested) || requested.some(p => !supported.has(p) || !granted.has(p))) {
    throw new Error("TEAM_ACL_INVALID: Resource permissions may only narrow their role.");
  }
  return [...new Set(requested.filter(p => team.has(p)))];
}

/**
 * M12 opt-in enforcement intersects:
 *  legacy authenticated subject / per-user allowlist / role permissions
 *  AND team membership / resource grant / resource capability.
 *
 * Never union permissions across projects or teams. An ambiguous external
 * Project registered in two team contexts for the same subject fails closed.
 *
 * Future DB-primary enrollment is separate: this compatibility phase can
 * NARROW existing GitHub identities, never authorize an additional project.
 */
export function restrictPrincipalToTeamAccess(
  principal: AuthenticatedPrincipal,
  snapshot: TeamAccessSnapshot,
): AuthenticatedPrincipal {
  if (!snapshot || !Array.isArray(snapshot.grants) || snapshot.grants.length > 1000) {
    throw new Error("TEAM_ACL_INVALID: Access snapshot is invalid.");
  }

  const legacyIds = new Set(principal.projectIds);
  const legacyCapabilities = new Set(principal.permissions);
  const perProject: Record<string, ProjectPermission[]> = Object.create(null);

  for (const grant of snapshot.grants) {
    if (
      !grant || typeof grant !== "object" ||
      typeof grant.teamId !== "string" || !grant.teamId ||
      typeof grant.resourceId !== "string" || !grant.resourceId ||
      typeof grant.externalResourceId !== "string" || !grant.externalResourceId ||
      (grant.provider !== "github_projects" && grant.provider !== "jira")
    ) {
      throw new Error("TEAM_ACL_INVALID: Invalid resource grant.");
    }
    // Jira IDs never enter the legacy GitHub Project ID namespace.
    if (grant.provider !== "github_projects") continue;
    const projectId = grant.externalResourceId;
    if (!legacyIds.has(projectId)) continue;
    // Two independently configured team scopes could assign different roles to
    // one physical Project. Deny ambiguity rather than combine privileges.
    if (Object.hasOwn(perProject, projectId)) {
      throw new Error("TEAM_ACL_AMBIGUOUS: GitHub Project has multiple team grants.");
    }
    perProject[projectId] = accessPermissions(grant).filter(p => legacyCapabilities.has(p));
  }

  return {
    ...principal,
    projectIds: principal.projectIds.filter(id => Object.hasOwn(perProject, id) &&
      perProject[id]!.includes("project.read")),
    resourcePermissions: perProject,
  };
}
