import { z } from "zod";
import { createHash } from "node:crypto";
import { assertSessionBoundOperator, operatorConfig, type VerifiedOperator } from "../http/operator-auth.js";
import { OAUTH_WRITE_SCOPE, scopeIncludes } from "../oauth/stateless.js";
import { principalHasProjectPermission } from "../core/identity/principal.js";

const managedSubject = z.string().startsWith("user:managed:").refine((s) => z.uuid().safeParse(s.slice(13)).success);
export const scopedIssueInput = z.object({ operationId: z.uuid(), subject: managedSubject, expectedVersion: z.number().int().positive().safe() }).strict();
const leaseSchema = z.object({ idHash: z.string().regex(/^[0-9a-f]{64}$/), authEpoch: z.number().int().positive().safe() }).strict();
const responseSchema = z.object({ operationId: z.uuid(), credentialId: z.uuid(), subject: managedSubject,
  userVersion: z.number().int().positive().safe(), keyVersion: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(),
  replayed: z.boolean(), candidateAccepted: z.boolean(), secretUnavailable: z.boolean() }).strict()
  .refine((r) => r.candidateAccepted === !r.replayed && r.secretUnavailable === r.replayed);
/** Server policy manifest, not an OAuth credential. Sort every set so DB/worker comparisons are stable. */
export function operatorPolicyDigest(operator: VerifiedOperator): string {
  assertSessionBoundOperator(operator);
  const config = operatorConfig(operator), p = operator.principal;
  return createHash("sha256").update(JSON.stringify({ subject: operator.proof.subject, source: operator.proof.source,
    sourceReference: operator.proof.identityVersion ?? operator.proof.credentialId, role: p.role,
    owners: [...new Set(config.allowedOwners.map((v) => v.toLowerCase()))].sort(),
    allowedProjects: [...new Set(config.allowedProjectIds)].sort(), projects: [...p.projectIds].sort(), permissions: [...p.permissions].sort(),
    perProject: [...p.projectIds].sort().map((id) => [id, p.permissions.filter((permission) => principalHasProjectPermission(p, id, permission)).sort()]),
  })).digest("hex");
}
/** Only accepts branded current operators; shared by issuance and server session lease lifecycle. */
export function scopedActorContext(operator: VerifiedOperator, lease: z.infer<typeof leaseSchema>): Record<string, unknown> {
  assertSessionBoundOperator(operator); leaseSchema.parse(lease);
  if (operator.principal.role !== "admin" || !scopeIncludes(operator.proof.scope, OAUTH_WRITE_SCOPE)) throw new Error("ADMIN_ACTOR_DENIED");
  const config = operatorConfig(operator), projectIds = operator.principal.projectIds.filter((id) =>
    config.allowedProjectIds.includes(id) && principalHasProjectPermission(operator.principal, id, "project.write"));
  if (!config.allowedOwners.length || !projectIds.length) throw new Error("ADMIN_ACTOR_DENIED");
  return { subject: operator.proof.subject, source: operator.proof.source, sourceReference: operator.proof.identityVersion ?? operator.proof.credentialId,
    proofExpiresAt: operator.proof.expiresAt, scope: operator.proof.scope.split(/\s+/).filter(Boolean),
    leaseIdHash: lease.idHash, authEpoch: lease.authEpoch, policyDigest: operatorPolicyDigest(operator),
    allowedOwners: config.allowedOwners.map((id) => id.toLowerCase()), projectIds,
    projectPermissions: Object.fromEntries(projectIds.map((id) => [id, operator.principal.permissions.filter((p) => principalHasProjectPermission(operator.principal, id, p))])) };
}
export interface ScopedIssueTransport {
  /** Trusted server adapter only. Never expose service credentials or raw RPC payloads to a client. */
  rpc(name: "mcp_admin_issue_credential_scoped_v1", args: { p_actor: Record<string, unknown>; p_request: z.infer<typeof scopedIssueInput>; p_candidate_hash: string }): Promise<unknown>;
}
export interface ScopedIssueOptions {
  enabled?: boolean;
  refresh: () => Promise<VerifiedOperator>;
  leaseFor: (operator: VerifiedOperator) => Promise<z.infer<typeof leaseSchema>>;
  /** Injection-only candidate hash. This module does not generate, retain or return raw credentials. */
  candidateHashFor: (operationId: string) => Promise<string>;
  transport: ScopedIssueTransport;
}
/** Not installed in router/console. Preview + explicit server opt-in; missing configuration stays closed. */
export class ScopedCredentialRpc {
  constructor(private readonly options: ScopedIssueOptions) {}
  async issue(body: unknown): Promise<z.infer<typeof responseSchema>> {
    if (this.options.enabled !== true || process.env.VERCEL_ENV !== "preview") throw new Error("ADMIN_RPC_DISABLED: Scoped credential RPC is disabled.");
    const parsed = scopedIssueInput.safeParse(body);
    if (!parsed.success) throw new Error("ADMIN_RPC_INPUT_INVALID: Invalid scoped issue request.");
    const input = parsed.data;
    try {
      const first = await this.options.refresh(); assertSessionBoundOperator(first);
      const original = operatorConfig(first);
      const lease = leaseSchema.parse(await this.options.leaseFor(first));
      const candidateHash = z.string().regex(/^[0-9a-f]{64}$/).parse(await this.options.candidateHashFor(input.operationId));
      // The candidate/lease loaders may await. Confirm the same source after both and narrow the original ceiling.
      const current = await this.options.refresh(); assertSessionBoundOperator(current);
      if (current.proof.subject !== first.proof.subject || current.proof.source !== first.proof.source
        || current.proof.identityVersion !== first.proof.identityVersion || current.proof.credentialId !== first.proof.credentialId
        || current.proof.expiresAt !== first.proof.expiresAt || current.proof.scope !== first.proof.scope
        || current.principal.role !== "admin" || !scopeIncludes(current.proof.scope, OAUTH_WRITE_SCOPE)) throw new Error("denied");
      const config = operatorConfig(current);
      const allowedOwners = config.allowedOwners.filter((id) => original.allowedOwners.includes(id)).map((id) => id.toLowerCase());
      const projectIds = current.principal.projectIds.filter((id) => config.allowedProjectIds.includes(id) && original.allowedProjectIds.includes(id)
        && first.principal.projectIds.includes(id) && principalHasProjectPermission(current.principal, id, "project.write"));
      if (!allowedOwners.length || !projectIds.length) throw new Error("denied");
      const projectPermissions = Object.fromEntries(projectIds.map((id) => [id, current.principal.permissions.filter((p) =>
        principalHasProjectPermission(current.principal, id, p) && principalHasProjectPermission(first.principal, id, p))]));
      const p_actor = { ...scopedActorContext(current, lease), allowedOwners, projectIds, projectPermissions };
      const raw = await this.options.transport.rpc("mcp_admin_issue_credential_scoped_v1", { p_actor, p_request: input, p_candidate_hash: candidateHash });
      const result = responseSchema.parse(raw);
      if (result.operationId !== input.operationId || result.subject !== input.subject || result.userVersion !== input.expectedVersion
        || result.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error("invalid response");
      return result;
    } catch {
      // No raw SQL errors, secret hashes, server URLs or credential payloads cross this boundary. No automatic retry.
      throw new Error("ADMIN_RPC_UNCONFIRMED: Scoped issue was not confirmed; inspect the same operation before retrying.");
    }
  }
}
