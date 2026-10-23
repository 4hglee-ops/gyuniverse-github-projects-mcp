import { z } from "zod";
import { principalHasProjectPermission, permissionsForRole, type ProjectRole } from "../core/identity/principal.js";
import { assertSessionBoundOperator, assertVerifiedOperator, operatorConfig, type VerifiedOperator } from "../http/operator-auth.js";
import { OAUTH_WRITE_SCOPE, scopeIncludes } from "../oauth/stateless.js";

export const adminOperation = z.enum(["admin.users.read", "admin.users.write", "admin.credentials.read", "admin.credentials.issue", "admin.credentials.revoke", "admin.audit.read"]);
export type AdminOperation = z.infer<typeof adminOperation>;
const authoritySchema = z.object({ subject: z.string().min(1).max(256), operations: z.array(adminOperation).max(6),
  projectIds: z.array(z.string().min(1).max(256)).min(1).max(100), maxGrantRole: z.enum(["viewer", "member", "admin"]) }).strict();
export type AdminAuthority = z.infer<typeof authoritySchema>;
const rank: Record<ProjectRole, number> = { viewer: 0, member: 1, admin: 2 };
const writes = new Set<AdminOperation>(["admin.users.write", "admin.credentials.issue", "admin.credentials.revoke"]);
const requestSchema = z.object({ operation: adminOperation, projectIds: z.array(z.string().min(1).max(256)).min(1).max(30),
  targetRole: z.enum(["viewer", "member", "admin"]).optional() }).strict();

/** Explicit management authority is separate from Project role defaults. No environment grants are installed here.
 * Target scope/role must come from the server's complete target record, never a client-selected subset.
 * This authorizes management metadata only; actual GitHub mutations still require the separate Core write gate.
 */
export class AdminPolicy {
  private readonly authority: AdminAuthority | null;
  constructor(authority: AdminAuthority | null = null, private readonly enabled = false) {
    this.authority = authority ? authoritySchema.parse(structuredClone(authority)) : null;
  }
  authorize(operator: VerifiedOperator, input: { operation: AdminOperation; projectIds: string[]; targetRole?: ProjectRole }) {
    assertVerifiedOperator(operator); assertSessionBoundOperator(operator);
    const authority = this.authority, config = operatorConfig(operator);
    const denied = () => { throw new Error("ADMIN_PERMISSION_DENIED: Explicit scoped management authority is required."); };
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return denied();
    input = parsed.data;
    const operation = input.operation;
    if (this.enabled !== true || !authority || authority.subject !== operator.proof.subject || operator.principal.role !== "admin"
      || operator.proof.expiresAt <= Math.floor(Date.now() / 1000)
      || !authority.operations.includes(operation) || !config.allowedOwners.length || !config.allowedProjectIds.length
      || !input.projectIds.length || input.projectIds.length > 30 || new Set(input.projectIds).size !== input.projectIds.length) return denied();
    if (input.projectIds.some((id) => !authority.projectIds.includes(id) || !config.allowedProjectIds.includes(id)
      || !principalHasProjectPermission(operator.principal, id, "project.read"))) return denied();
    if (writes.has(operation) && !scopeIncludes(operator.proof.scope, OAUTH_WRITE_SCOPE)) return denied();
    if (writes.has(operation) && input.projectIds.some((id) => !principalHasProjectPermission(operator.principal, id, "project.write"))) return denied();
    if ((operation === "admin.users.write" || operation === "admin.credentials.issue") && input.targetRole === undefined) return denied();
    if (input.targetRole !== undefined && (!Object.hasOwn(rank, input.targetRole) || rank[input.targetRole] > rank[authority.maxGrantRole])) return denied();
    if (input.targetRole !== undefined && input.projectIds.some((id) => permissionsForRole(input.targetRole!).some((p) => !principalHasProjectPermission(operator.principal, id, p)))) return denied();
    return { allowed: true as const, actorId: operator.proof.subject, operation, projectIds: [...input.projectIds] };
  }
}
