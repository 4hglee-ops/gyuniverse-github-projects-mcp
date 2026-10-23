import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AdminPolicy, type AdminOperation } from "./admin-policy.js";
import type { VerifiedOperator } from "../http/operator-auth.js";

const ids = z.array(z.string().min(1).max(256)).min(1).max(30).refine((v) => new Set(v).size === v.length);
const role = z.enum(["viewer", "member", "admin"]);
const subject = z.string().regex(/^user:managed:[0-9a-f-]{36}$/).refine((s) => z.uuid().safeParse(s.slice(13)).success);
export const managedUserSchema = z.object({ subject, displayName: z.string().trim().min(1).max(100), githubLogin: z.string().max(100),
  role, projectIds: ids, enabled: z.boolean(), version: z.number().int().positive() }).strict();
export const managedKeySchema = z.object({ id: z.uuid(), subject, role, projectIds: ids, revoked: z.boolean(), version: z.number().int().positive() }).strict();
export const adminAuditSchema = z.object({ id: z.uuid(), actorId: z.string().min(1).max(256), operation: z.string().max(80),
  target: z.string().max(256), projectIds: ids, at: z.number().int().nonnegative() }).strict();
export type ManagedUser = z.infer<typeof managedUserSchema>;
export type ManagedKey = z.infer<typeof managedKeySchema>;
export type AdminAudit = z.infer<typeof adminAuditSchema>;
const authorizationTargetSchema = z.object({ projectIds: ids, role }).strict();
const receiptSchema = z.object({ authorizationTargets: z.array(authorizationTargetSchema).min(1).max(3), actorId: z.string().min(1).max(256), digest: z.string().regex(/^[0-9a-f]{64}$/),
  result: z.object({ operationId: z.uuid(), target: z.string().min(1).max(256), version: z.number().int().positive() }).strict() }).strict();
type Receipt = z.infer<typeof receiptSchema>;
export interface ManagementState { users: ManagedUser[]; credentials: ManagedKey[]; audit: AdminAudit[]; receipts: Record<string, Receipt> }
/** A DB implementation must lock/revalidate actor + complete targets, expectedVersion and operationId inside one transaction.
 * No service-role RPC or managed OAuth resolver is activated by this contract. */
export interface AdminManagementStore {
  readonly persistence: "synthetic-only" | "shared";
  read(): Promise<ManagementState>;
  transaction<T>(work: (state: ManagementState) => Promise<T>): Promise<T>;
  /** Only a synthetic test issuer exists here. A real credential issuer requires a separately verified DB contract. */
  syntheticSecret?(id: string): string;
}
function state(raw: ManagementState): ManagementState {
  const p = z.object({ users: z.array(managedUserSchema).max(1000), credentials: z.array(managedKeySchema).max(1000), audit: z.array(adminAuditSchema).max(1000), receipts: z.record(z.uuid(), receiptSchema) }).strict().safeParse(raw);
  if (!p.success) throw new Error("ADMIN_STORE_INVALID: Invalid management metadata.");
  return raw;
}
/** No environment/default constructor path uses this double. Values cannot authenticate against OAuth. */
export class MemoryAdminManagementStore implements AdminManagementStore {
  readonly persistence = "synthetic-only";
  private data: ManagementState;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(initial: Partial<Pick<ManagementState, "users" | "credentials" | "audit">> = {}) {
    this.data = structuredClone(state({ users: [], credentials: [], audit: [], ...initial, receipts: {} }));
  }
  async read() { await this.tail; return structuredClone(this.data); }
  syntheticSecret(id: string) { return "synthetic-only-" + id; }
  transaction<T>(work: (draft: ManagementState) => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      const draft = structuredClone(this.data), result = await work(draft);
      this.data = structuredClone(state(draft)); return result;
    });
    this.tail = pending.then(() => undefined, () => undefined); return pending;
  }
}
export interface ManagementRuntime { store: AdminManagementStore; policy: (operator: VerifiedOperator) => Promise<AdminPolicy> | AdminPolicy }
const reference = z.object({ operationId: z.uuid() });
const create = reference.extend({ displayName: managedUserSchema.shape.displayName, githubLogin: managedUserSchema.shape.githubLogin,
  role, projectIds: ids }).strict();
const update = reference.extend({ subject, role, projectIds: ids, enabled: z.boolean(), expectedVersion: z.number().int().positive() }).strict();
const issue = reference.extend({ subject, expectedVersion: z.number().int().positive() }).strict();
const revoke = reference.extend({ id: z.uuid(), expectedVersion: z.number().int().positive() }).strict();
const schemas = { users: create, "users/update": update, credentials: issue, "credentials/revoke": revoke };
function invalid(message = "Management input is invalid."): never { throw new Error("ADMIN_INPUT_INVALID: " + message); }
function denied(): never { throw new Error("ADMIN_PERMISSION_DENIED: Management scope is unavailable."); }
function authorize(policy: AdminPolicy, operator: VerifiedOperator, operation: AdminOperation, target: { projectIds: string[]; role?: ManagedUser["role"] }) {
  return policy.authorize(operator, { operation, projectIds: target.projectIds, ...(target.role ? { targetRole: target.role } : {}) });
}
function allows(policy: AdminPolicy, operator: VerifiedOperator, operation: AdminOperation, target: { projectIds: string[]; role?: ManagedUser["role"] }) {
  try { authorize(policy, operator, operation, target); return true; } catch { return false; }
}
export async function handleAdminManagement(path: string, method: string, body: unknown, refresh: () => Promise<VerifiedOperator>, runtime: ManagementRuntime): Promise<unknown> {
  if (method === "GET" && path === "overview") {
    const snapshot = state(await runtime.store.read()), policy = await runtime.policy(await refresh()), operator = await refresh();
    const projects = operator.principal.projectIds.filter((id) => allows(policy, operator, "admin.users.read", { projectIds: [id] }));
    const credentials = snapshot.credentials.filter((key) => {
      const user = snapshot.users.find((u) => u.subject === key.subject);
      return user && allows(policy, operator, "admin.credentials.read", key) && allows(policy, operator, "admin.credentials.read", user);
    });
    const users = snapshot.users.filter((u) => allows(policy, operator, "admin.users.read", u));
    const audit = snapshot.audit.filter((entry) => allows(policy, operator, "admin.audit.read", entry)).slice(-100).reverse();
    const hasReadScope = operator.principal.projectIds.some((id) => (["admin.users.read", "admin.credentials.read", "admin.audit.read"] as const).some((operation) => allows(policy, operator, operation, { projectIds: [id] })));
    if (!hasReadScope) return denied();
    return { actorId: operator.proof.subject, syntheticOnly: runtime.store.persistence === "synthetic-only", projectIds: projects,
      canCreateUser: projects.some((id) => allows(policy, operator, "admin.users.write", { projectIds: [id], role: "viewer" })),
      users: users.map((u) => ({ ...u, canUpdate: allows(policy, operator, "admin.users.write", u), canIssue: u.enabled && allows(policy, operator, "admin.credentials.issue", u) })),
      credentials: credentials.map((key) => ({ ...key, canRevoke: allows(policy, operator, "admin.credentials.revoke", key) })), audit };
  }
  if (method !== "POST" || !Object.hasOwn(schemas, path)) throw new Error("ADMIN_ROUTE_NOT_FOUND: Unsupported management route.");
  const parsed = schemas[path as keyof typeof schemas].safeParse(body); if (!parsed.success) return invalid();
  const input = parsed.data;
  const digest = createHash("sha256").update(JSON.stringify([path, input])).digest("hex");
  // The callback is the transaction boundary. Refresh and policy checks belong inside it, after waiting for the lock.
  return runtime.store.transaction(async (draft) => {
    state(draft);
    const policy = await runtime.policy(await refresh()), operator = await refresh();
    let target: ManagedUser | ManagedKey | undefined, operation: AdminOperation;
    // Capture complete pre-mutation scopes/roles, including the parent and requested new scope.
    // Each snapshot stays separate so a 30-Project old/new scope need not be truncated into a union.
    const authorizationTargets: Array<z.infer<typeof authorizationTargetSchema>> = [];
    const authorizeTarget = (record: { projectIds: string[]; role: ManagedUser["role"] }) => {
      authorize(policy, operator, operation, record);
      authorizationTargets.push({ projectIds: [...record.projectIds], role: record.role });
    };
    if (path === "users") {
      operation = "admin.users.write"; const { operationId: _operationId, ...metadata } = create.parse(input);
      target = managedUserSchema.parse({ ...metadata, subject: "user:managed:" + randomUUID(), enabled: true, version: 1 });
      authorizeTarget(target);
    } else if (path === "credentials/revoke") {
      operation = "admin.credentials.revoke"; const arg = revoke.parse(input);
      target = draft.credentials.find((key) => key.id === arg.id); if (!target) return denied();
      const user = draft.users.find((u) => u.subject === target!.subject); if (!user) return denied();
      authorizeTarget(target); authorizeTarget(user);
    } else {
      const arg = path === "users/update" ? update.parse(input) : issue.parse(input);
      operation = path === "users/update" ? "admin.users.write" : "admin.credentials.issue";
      target = draft.users.find((u) => u.subject === arg.subject); if (!target) return denied();
      authorizeTarget(target);
      if (path === "users/update") authorizeTarget(update.parse(input));
      if (path === "credentials" && !(target as ManagedUser).enabled) return denied();
    }
    const existing = draft.receipts[input.operationId];
    if (existing) {
      if (existing.actorId !== operator.proof.subject || existing.digest !== digest) throw new Error("ADMIN_OPERATION_CONFLICT: Operation reference is already used.");
      // Replays need current authority for the original operation, not only the narrowed current parent.
      for (const original of existing.authorizationTargets) authorize(policy, operator, operation, original);
      if (path === "credentials") {
        const issued = draft.credentials.find((key) => key.id === existing.result.target);
        if (!issued || issued.revoked || issued.subject !== target.subject) return denied();
        authorize(policy, operator, operation, issued);
      }
      if (path === "users") {
        const current = draft.users.find((u) => u.subject === existing.result.target); if (!current) return denied();
        authorize(policy, operator, operation, current);
      }
      return { ...existing.result, replayed: true, secretUnavailable: path === "credentials" };
    }
    if (draft.audit.length >= 1000 || Object.keys(draft.receipts).length >= 1000 || draft.users.length >= 1000 || draft.credentials.length >= 1000)
      throw new Error("ADMIN_STORE_FULL: Management capacity reached.");
    if ("expectedVersion" in input && target.version !== input.expectedVersion) throw new Error("ADMIN_VERSION_CONFLICT: Target changed; reload before creating a new operation.");
    let secret: string | undefined, targetId: string;
    if (path === "users") { const user = target as ManagedUser; draft.users.push(user); targetId = user.subject; }
    else if (path === "users/update") {
      const user = target as ManagedUser, arg = update.parse(input); Object.assign(user, { role: arg.role, projectIds: arg.projectIds, enabled: arg.enabled, version: user.version + 1 }); targetId = user.subject;
    } else if (path === "credentials") {
      // Real key issuance is deliberately unavailable. This contract is not an OAuth issuer.
      if (runtime.store.persistence !== "synthetic-only" || !runtime.store.syntheticSecret) throw new Error("ADMIN_REAL_ISSUER_UNAVAILABLE: Verified DB issuance is required.");
      const id = randomUUID(); secret = runtime.store.syntheticSecret(id);
      if (!/^synthetic-only-[a-zA-Z0-9-]{1,100}$/.test(secret)) throw new Error("ADMIN_STORE_INVALID: Issuer returned a non-synthetic value.");
      const user = target as ManagedUser;
      const key = { id, subject: user.subject, role: user.role, projectIds: [...user.projectIds], revoked: false, version: 1 };
      draft.credentials.push(key); target = key; targetId = id;
    } else { const key = target as ManagedKey; key.revoked = true; key.version++; targetId = key.id; }
    const result = { operationId: input.operationId, target: targetId, version: target.version };
    draft.audit.push({ id: randomUUID(), actorId: operator.proof.subject, operation, target: targetId, projectIds: [...target.projectIds], at: Math.floor(Date.now() / 1000) });
    draft.receipts[input.operationId] = { actorId: operator.proof.subject, digest, result, authorizationTargets };
    return { ...result, replayed: false, ...(secret ? { secret, syntheticOnly: true } : {}) };
  });
}
