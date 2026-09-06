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
  | "item.relationship.write"
  | "bulk.preview"
  | "bulk.approve"
  | "bulk.apply";

export const PROJECT_PERMISSIONS: readonly ProjectPermission[] = [
  "project.read",
  "project.write",
  "item.add",
  "item.create",
  "item.assign",
  "item.update_field",
  "item.update_status",
  "item.update_priority",
  "item.relationship.write",
  "bulk.preview",
  "bulk.approve",
  "bulk.apply",
];

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
    "bulk.preview",
    "bulk.approve",
    "bulk.apply",
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
  options: Partial<Omit<AuthenticatedPrincipal, "id" | "role" | "permissions">> & {
    permissions?: ProjectPermission[];
  } = {},
): AuthenticatedPrincipal {
  const defaults = permissionsForRole(role);
  const permissions = [...new Set(options.permissions ?? defaults)];
  if (permissions.some((permission) => !defaults.includes(permission))) {
    throw new Error(`Role '${role}' permission overrides may narrow but not expand its defaults.`);
  }
  return {
    id,
    role,
    permissions,
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
