export type ProjectRole = "admin" | "member" | "viewer";

export type ProjectPermission =
  | "project.read"
  | "project.write"
  | "item.add"
  | "item.create"
  | "item.assign"
  | "item.update_field"
  | "item.update_status"
  | "item.update_priority"
  | "item.relationship.write";

export interface AuthenticatedPrincipal {
  id: string;
  displayName?: string | null;
  githubLogin?: string | null;
  role: ProjectRole;
  permissions: ProjectPermission[];
  projectIds: string[];
  source: "oauth" | "local" | "system";
}

const ROLE_PERMISSIONS: Record<ProjectRole, readonly ProjectPermission[]> = {
  admin: [
    "project.read",
    "project.write",
    "item.add",
    "item.create",
    "item.assign",
    "item.update_field",
    "item.update_status",
    "item.update_priority",
    "item.relationship.write",
  ],
  member: [
    "project.read",
    "project.write",
    "item.add",
    "item.update_status",
    "item.update_priority",
  ],
  viewer: ["project.read"],
};

export function permissionsForRole(role: ProjectRole): ProjectPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function principalForRole(
  id: string,
  role: ProjectRole,
  options: Partial<Omit<AuthenticatedPrincipal, "id" | "role" | "permissions">> = {},
): AuthenticatedPrincipal {
  return {
    id,
    role,
    permissions: permissionsForRole(role),
    projectIds: [...new Set(options.projectIds ?? [])],
    displayName: options.displayName ?? null,
    githubLogin: options.githubLogin ?? null,
    source: options.source ?? "system",
  };
}

export function principalHasPermission(
  principal: AuthenticatedPrincipal | null | undefined,
  permission: ProjectPermission,
): boolean {
  return Boolean(principal?.permissions.includes(permission));
}

export function principalHasProject(
  principal: AuthenticatedPrincipal | null | undefined,
  projectId: string,
): boolean {
  return Boolean(principal?.projectIds.includes(projectId));
}
