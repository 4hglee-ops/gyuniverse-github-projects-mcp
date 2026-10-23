import { z } from "zod";
import { WritePolicy } from "../core/policy/write-policy.js";
import type { AppConfig } from "../config.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { principalForRole, permissionsForRole, PROJECT_PERMISSIONS, type AuthenticatedPrincipal } from "../core/identity/principal.js";
import { createTeamAccessStore, resolveTeamScopedPrincipal } from "../core/teams/team-access-runtime.js";
import type { TeamAccessStore } from "../core/teams/team-access-store.js";
import { oauthAccessTokenPayload, OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE, scopeIncludes } from "../oauth/stateless.js";

const claims = z.object({ sub: z.string().min(1).max(256), scope: z.string().max(200), exp: z.number().int().positive(),
  identityVersion: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  credentialId: z.uuid().optional() });
const permissions = z.array(z.enum(PROJECT_PERMISSIONS)).max(PROJECT_PERMISSIONS.length);
const principalSchema = z.object({ id: z.string().min(1).max(256), role: z.enum(["admin", "member", "viewer"]),
  permissions, projectIds: z.array(z.string().min(1).max(256)).max(1000),
  resourcePermissions: z.record(z.string().min(1).max(256), permissions).optional(),
  source: z.enum(["oauth", "local", "system"]), displayName: z.string().max(120).nullable().optional(), githubLogin: z.string().max(100).nullable().optional(),
});
export interface OperatorProof {
  readonly subject: string; readonly scope: string; readonly expiresAt: number;
  readonly source: "env" | "managed" | "legacy";
  readonly identityVersion?: string; readonly credentialId?: string;
}
export interface VerifiedOperator {
  readonly principal: AuthenticatedPrincipal;
  readonly proof: OperatorProof;
}
export interface OperatorAuthOptions {
  registry?: () => OAuthIdentityRegistry;
  teamStore?: () => TeamAccessStore | null;
  bindingKey?: string;
  now?: () => number;
  /** Trusted server adapter only. No DB adapter is enabled by this foundation module. */
  managedPrincipal?: (subject: string, credentialId: string) => Promise<AuthenticatedPrincipal | null>;
  /** Revalidation can only intersect a current server config with the original ceiling. */
  currentConfig?: () => AppConfig;
}
const verified = new WeakMap<object, AppConfig>();
export function assertVerifiedOperator(value: unknown): asserts value is VerifiedOperator {
  if (!value || typeof value !== "object" || !verified.has(value)) throw new Error("OPERATOR_AUTH_REQUIRED: Resolve a verified operator first.");
}
export function operatorConfig(operator: VerifiedOperator): AppConfig {
  assertVerifiedOperator(operator);
  const config = verified.get(operator)!;
  return { ...config, allowedOwners: [...config.allowedOwners], allowedProjectIds: [...config.allowedProjectIds] };
}
export function assertSessionBoundOperator(operator: VerifiedOperator, now = Math.floor(Date.now() / 1000)): void {
  assertVerifiedOperator(operator);
  if (!Number.isSafeInteger(now) || now < 0 || operator.proof.expiresAt <= now) throw new Error("OPERATOR_AUTH_REQUIRED: Operator proof expired.");
  if (operator.proof.source === "legacy" || (operator.proof.source === "env" && !operator.proof.identityVersion)) {
    throw new Error("OPERATOR_REAUTH_REQUIRED: An individually bound credential is required for an admin session.");
  }
}
async function resolveProof(proof: OperatorProof, config: AppConfig, options: OperatorAuthOptions): Promise<VerifiedOperator> {
  const assertLive = () => {
    const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
    if (!Number.isSafeInteger(now) || now < 0 || proof.expiresAt <= now || !scopeIncludes(proof.scope, OAUTH_READ_SCOPE)) throw new Error("OPERATOR_AUTH_REQUIRED: Operator proof expired or lacks read scope.");
  };
  assertLive();
  let principal: AuthenticatedPrincipal | null;
  try {
    if (proof.source === "managed") {
      if (!proof.credentialId || !options.managedPrincipal) throw new Error("unavailable");
      principal = await options.managedPrincipal(proof.subject, proof.credentialId);
    } else if (proof.source === "legacy") {
      principal = principalForRole(proof.subject, "viewer", { source: "oauth", projectIds: config.allowedProjectIds });
    } else {
      const registry = (options.registry ?? OAuthIdentityRegistry.fromEnvironment)();
      if (proof.identityVersion && registry.credentialVersion(proof.subject, options.bindingKey ?? process.env.MCP_OAUTH_SIGNING_SECRET?.trim() ?? "") !== proof.identityVersion) {
        throw new Error("invalid binding");
      }
      principal = registry.resolvePrincipal(proof.subject);
    }
    principal = principalSchema.parse(principal);
    if (principal.id !== proof.subject
      || principal.permissions.some((p) => !permissionsForRole(principal!.role).includes(p))) throw new Error("invalid identity");
  } catch { throw new Error("OPERATOR_IDENTITY_UNAVAILABLE: Current operator identity could not be verified."); }
  try { principal = await resolveTeamScopedPrincipal(principal, (options.teamStore ?? createTeamAccessStore)()); }
  catch { throw new Error("TEAM_ACL_UNAVAILABLE: Current operator access could not be verified."); }
  if (!principal) throw new Error("OPERATOR_AUTH_REQUIRED: Operator identity is unavailable.");
  assertLive();
  const scoped = structuredClone(principal);
  scoped.projectIds = scoped.projectIds.filter((id) => config.allowedProjectIds.includes(id));
  if (scoped.resourcePermissions) scoped.resourcePermissions = Object.fromEntries(Object.entries(scoped.resourcePermissions).filter(([id]) => scoped.projectIds.includes(id)));
  // Callers cannot mutate a verified role/capability snapshot in place.
  Object.freeze(scoped.permissions); Object.freeze(scoped.projectIds);
  if (scoped.resourcePermissions) { for (const p of Object.values(scoped.resourcePermissions)) Object.freeze(p); Object.freeze(scoped.resourcePermissions); }
  Object.freeze(scoped);
  const operator = Object.freeze({ principal: scoped, proof: Object.freeze({ ...proof }) });
  verified.set(operator, { ...config, allowedOwners: [...config.allowedOwners], allowedProjectIds: [...config.allowedProjectIds],
    writeEnabled: config.writeEnabled && scopeIncludes(proof.scope, OAUTH_WRITE_SCOPE) });
  return operator;
}
/** Used by the opt-in admin session bridge and the public bearer transports. */
export async function resolveVerifiedOperator(token: string, config: AppConfig, options: OperatorAuthOptions = {}): Promise<VerifiedOperator> {
  if (!token || token.length > 16_384) throw new Error("OPERATOR_AUTH_REQUIRED: A bounded bearer proof is required.");
  let payload: unknown;
  try { payload = await oauthAccessTokenPayload(token); } catch { throw new Error("OPERATOR_AUTH_REQUIRED: Bearer proof could not be verified."); }
  const parsed = claims.safeParse(payload);
  if (!parsed.success) throw new Error("OPERATOR_AUTH_REQUIRED: Bearer proof is invalid.");
  const p = parsed.data, managed = p.sub.startsWith("user:managed:");
  if (managed !== Boolean(p.credentialId) || (managed && (!z.uuid().safeParse(p.sub.slice("user:managed:".length)).success || p.identityVersion))) {
    throw new Error("OPERATOR_AUTH_REQUIRED: Managed subject and credential binding must agree.");
  }
  return resolveProof({ subject: p.sub, scope: p.scope, expiresAt: p.exp, source: managed ? "managed" : p.sub === "gyuniverse-projects-team" ? "legacy" : "env",
    ...(p.identityVersion ? { identityVersion: p.identityVersion } : {}), ...(p.credentialId ? { credentialId: p.credentialId } : {}) }, config, options);
}
export async function revalidateVerifiedOperator(operator: VerifiedOperator, options: OperatorAuthOptions = {}): Promise<VerifiedOperator> {
  assertVerifiedOperator(operator);
  let config = operatorConfig(operator);
  // Invalidate before any await: a failed refresh must never fall back to the old snapshot.
  verified.delete(operator);
  if (options.currentConfig) {
    try {
      const current = options.currentConfig();
      config = { ...config, githubToken: current.githubToken, allowedOwners: config.allowedOwners.filter((id) => current.allowedOwners.includes(id)),
        allowedProjectIds: config.allowedProjectIds.filter((id) => current.allowedProjectIds.includes(id)), writeEnabled: config.writeEnabled && current.writeEnabled };
    } catch { throw new Error("OPERATOR_CONFIG_UNAVAILABLE: Current server scope could not be verified."); }
  }
  return resolveProof(operator.proof, config, options);
}

/** Only pass a trusted server-side store loader; no caller-supplied subject/role/capabilities are accepted. */
export async function resolveSessionOperator(
  load: () => Promise<{ proof: OperatorProof; expiresAt: number; revokedAt: number | null } | null>,
  config: AppConfig, options: OperatorAuthOptions = {},
): Promise<VerifiedOperator> {
  const live = (row: Awaited<ReturnType<typeof load>>) => row && row.revokedAt === null
    && Number.isSafeInteger(row.expiresAt) && row.expiresAt > (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  let row;
  try { row = await load(); } catch { throw new Error("ADMIN_SESSION_STORE_UNAVAILABLE: Session lookup failed."); }
  if (!live(row)) throw new Error("OPERATOR_AUTH_REQUIRED: Session is absent, revoked or expired.");
  const proof = row!.proof;
  const parsed = claims.safeParse({ sub: proof.subject, scope: proof.scope, exp: proof.expiresAt, identityVersion: proof.identityVersion, credentialId: proof.credentialId });
  if (!parsed.success || !["env", "managed"].includes(proof.source)
    || (proof.source === "env" && (!proof.identityVersion || proof.credentialId || proof.subject.startsWith("user:managed:") || proof.subject === "gyuniverse-projects-team"))
    || (proof.source === "managed" && (!proof.credentialId || proof.identityVersion || !proof.subject.startsWith("user:managed:") || !z.uuid().safeParse(proof.subject.slice("user:managed:".length)).success))) {
    throw new Error("OPERATOR_AUTH_REQUIRED: Stored session proof is invalid.");
  }
  const operator = await resolveProof(proof, config, options);
  try {
    const current = await load();
    if (!live(current) || current!.expiresAt !== row!.expiresAt || JSON.stringify(current!.proof) !== JSON.stringify(proof)) throw new Error("changed");
    assertSessionBoundOperator(operator, (options.now ?? (() => Math.floor(Date.now() / 1000)))());
    return operator;
  } catch {
    verified.delete(operator);
    throw new Error("OPERATOR_AUTH_REQUIRED: Session changed during authorization.");
  }
}

/** One request's View apply guard. Failed refresh stays failed, and concurrent callers serialize. */
export function operatorViewWriteGuard(operator: VerifiedOperator, options: OperatorAuthOptions = {}): (projectId: string) => Promise<void> {
  let pending = Promise.resolve(operator);
  return async (projectId) => {
    pending = pending.then((previous) => revalidateVerifiedOperator(previous, options));
    const current = await pending;
    new WritePolicy(operatorConfig(current), current.principal).authorize({ operation: "configure_project_views", projectId });
  };
}
