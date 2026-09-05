export type ProjectRole = "admin" | "member" | "viewer";

export type ProjectPermission =
  | "project.read"
  | "project.write"
  | "item.add"
  | "item.update_field"
  | "item.update_status"
  | "item.update_priority";

export interface AuthenticatedPrincipal {
  id: string;
  displayName?: string | null;
  githubLogin?: string | null;
  role: ProjectRole;
  permissions: ProjectPermission[];
  source: "oauth" | "local" | "system";
}

const ROLE_PERMISSIONS: Record<ProjectRole, readonly ProjectPermission[]> = {
  admin: [
    "project.read",
    "project.write",
    "item.add",
    "item.update_field",
    "item.update_status",
    "item.update_priority",
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
