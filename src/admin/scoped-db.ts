import { z } from "zod";
import { assertSessionBoundOperator, resolveSessionOperator, type OperatorAuthOptions, type VerifiedOperator } from "../http/operator-auth.js";
import type { AppConfig } from "../config.js";
import { PROJECT_PERMISSIONS, permissionsForRole, type AuthenticatedPrincipal } from "../core/identity/principal.js";
import type { AdminSessionRecord } from "./session-store.js";
import { operatorPolicyDigest, scopedActorContext, type ScopedIssueTransport } from "./scoped-credential-rpc.js";

const rpcNames = ["mcp_admin_issue_credential_scoped_v1", "mcp_admin_lease_v1", "mcp_admin_managed_principal_v1", "mcp_admin_overview_v1", "mcp_admin_management_v1", "mcp_admin_oauth_binding_v1"] as const;
type RpcName = typeof rpcNames[number];
export interface ScopedDbTransport { rpc(name: RpcName, args: Record<string, unknown>): Promise<unknown> }
function enabled(value?: boolean): void {
  if (value !== true || process.env.VERCEL_ENV !== "preview") throw Error("ADMIN_DB_DISABLED: DB preparation adapter is disabled.");
}
function unavailable(): never { throw Error("ADMIN_DB_UNCONFIRMED: DB operation was not confirmed; do not retry a mutation automatically."); }
/** Injection only. No env loader or deployed entrypoint installs this adapter. Never forward a user's bearer. */
export class PostgrestAdminTransport implements ScopedDbTransport, ScopedIssueTransport {
  #url: string; #key: string; #fetch: typeof fetch; #enabled: boolean; #timeout: number;
  constructor(options: { url: string; serviceKey: string; enabled?: boolean; fetcher?: typeof fetch; timeoutMs?: number }) {
    let url: URL;
    try { url = new URL(options.url); } catch { throw Error("ADMIN_DB_CONFIG_INVALID"); }
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash
      || !options.serviceKey || options.serviceKey.trim() !== options.serviceKey || /[\r\n]/.test(options.serviceKey)
      || options.serviceKey.startsWith("sb_publishable_")) throw Error("ADMIN_DB_CONFIG_INVALID");
    if (!options.serviceKey.startsWith("sb_secret_")) {
      try { if (JSON.parse(Buffer.from(options.serviceKey.split(".")[1]!, "base64url").toString()).role !== "service_role") throw Error(); }
      catch { throw Error("ADMIN_DB_CONFIG_INVALID"); }
    }
    this.#url = url.origin; this.#key = options.serviceKey; this.#fetch = options.fetcher ?? fetch;
    this.#enabled = options.enabled === true; this.#timeout = options.timeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.#timeout) || this.#timeout < 1 || this.#timeout > 5000) throw Error("ADMIN_DB_CONFIG_INVALID");
  }
  async rpc(name: RpcName, args: Record<string, unknown>): Promise<unknown> {
    enabled(this.#enabled);
    if (!rpcNames.includes(name)) return unavailable();
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("timeout")); }, this.#timeout); });
    try {
      return await Promise.race([deadline, (async () => {
        const body = JSON.stringify(args); if (Buffer.byteLength(body) > 65536) return unavailable();
        const headers: Record<string,string> = { apikey: this.#key, "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-store" };
        if (!this.#key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + this.#key;
        const res = await this.#fetch(this.#url + "/rest/v1/rpc/" + name, { method: "POST", headers, body,
          redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal });
        if (!res.ok || res.status !== 200 || res.redirected || !/^application\/json(?:;|$)/i.test(res.headers.get("content-type") ?? "")
          || Number(res.headers.get("content-length") ?? 0) > 65536 || !res.body) return unavailable();
        const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length;
          if (size > 65536 || controller.signal.aborted) return unavailable(); chunks.push(value); }
        } finally { await reader.cancel().catch(() => {}); }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      })()]);
    } catch { return unavailable(); } finally { clearTimeout(timer); controller.abort(); }
  }
}
const managedSubject = z.string().startsWith("user:managed:").refine((s) => z.uuid().safeParse(s.slice(13)).success);
const ids = z.array(z.string().min(1).max(256)).max(30).refine((a) => new Set(a).size === a.length);
const permissions = z.array(z.enum(PROJECT_PERMISSIONS)).max(PROJECT_PERMISSIONS.length).refine((a) => new Set(a).size === a.length);
const principal = z.object({ id: managedSubject, role: z.enum(["admin","member","viewer"]), permissions, projectIds: ids,
  resourcePermissions: z.record(z.string().min(1).max(256), permissions), source: z.literal("oauth") }).strict();
/** Existing operator resolver applies its server allowlist after this current DB + M12 snapshot. No cache/fallback. */
export class ManagedDbResolver {
  constructor(private readonly transport: ScopedDbTransport, private readonly options: { enabled?: boolean } = {}) {}
  async resolve(subject: string, credentialId: string): Promise<AuthenticatedPrincipal | null> {
    enabled(this.options.enabled);
    if (!managedSubject.safeParse(subject).success || !z.uuid().safeParse(credentialId).success) return unavailable();
    try {
      const raw = await this.transport.rpc("mcp_admin_managed_principal_v1", { p_subject: subject, p_credential_id: credentialId });
      if (raw === null) return null;
      const p = principal.parse(raw), ceiling = permissionsForRole(p.role);
      if (p.id !== subject || p.permissions.some((v) => !ceiling.includes(v))
        || Object.keys(p.resourcePermissions).some((id) => !p.projectIds.includes(id))
        || p.projectIds.some((id) => !p.resourcePermissions[id]?.includes("project.read") || p.resourcePermissions[id]!.some((v) => !p.permissions.includes(v)))) return unavailable();
      return p;
    } catch { return unavailable(); }
  }
}
const hash = z.string().regex(/^[0-9a-f]{64}$/), epoch = z.number().int().positive().safe();
const leaseResponse = z.object({ idHash: hash, authEpoch: epoch, policyDigest: hash, expiresAt: z.number().int().positive().safe() }).strict();
export interface DbLeaseOptions {
  enabled?: boolean;
  loadSession: () => Promise<AdminSessionRecord | null>;
  revokeSession: (idHash: string) => Promise<boolean>;
  config: () => AppConfig;
  auth: OperatorAuthOptions;
  /** Reviewed control-plane manifest. Never read/repair an epoch from an HTTP request or an authority lookup. */
  expectedEpoch: (operator: VerifiedOperator) => number;
  transport: ScopedDbTransport;
}
/** Bound server session -> current individual proof/ACL -> explicit DB lease. No Redis/SQL transaction is assumed. */
export class AdminDbLeaseBridge {
  // Revocation uncertainty poisons this coordinator. A fresh coordinator still fails if the server session is revoked.
  #closed = false;
  constructor(private readonly options: DbLeaseOptions) {}
  async refresh(): Promise<VerifiedOperator> {
    enabled(this.options.enabled); if (this.#closed) return unavailable();
    try { return await resolveSessionOperator(this.options.loadSession, this.options.config(), this.options.auth); }
    catch { return unavailable(); }
  }
  private async context(operator: VerifiedOperator) {
    assertSessionBoundOperator(operator);
    const session = await this.options.loadSession(), now = Math.floor(Date.now()/1000);
    if (this.#closed || !session || session.revokedAt !== null || session.createdAt > now || session.expiresAt <= now
      || session.expiresAt > Math.min(session.createdAt+900,operator.proof.expiresAt)
      || JSON.stringify(session.proof) !== JSON.stringify(operator.proof)) return unavailable();
    const authEpoch = epoch.parse(this.options.expectedEpoch(operator)), idHash = hash.parse(session.idHash);
    return { session, actor: scopedActorContext(operator, { idHash, authEpoch }), idHash, authEpoch };
  }
  async register(): Promise<{idHash: string; authEpoch: number}> {
    return this.lease("register", await this.refresh());
  }
  async leaseFor(operator: VerifiedOperator): Promise<{idHash: string; authEpoch: number}> {
    return this.lease("get", operator);
  }
  private async lease(action: "register"|"get", operator: VerifiedOperator) {
    enabled(this.options.enabled);
    try {
      const before = await this.context(operator), current = await this.refresh();
      if (operatorPolicyDigest(operator) !== operatorPolicyDigest(current) || JSON.stringify(operator.proof) !== JSON.stringify(current.proof)) return unavailable();
      const result = leaseResponse.parse(await this.options.transport.rpc("mcp_admin_lease_v1", { p_actor: before.actor,
        p_request: { action, ...(action === "register" ? { expiresAt: before.session.expiresAt } : {}) } }));
      const after = await this.context(await this.refresh());
      if (result.idHash !== before.idHash || result.authEpoch !== before.authEpoch || result.policyDigest !== before.actor.policyDigest
        || result.expiresAt !== before.session.expiresAt || after.idHash !== before.idHash || after.authEpoch !== before.authEpoch
        || after.actor.policyDigest !== before.actor.policyDigest || after.session.expiresAt !== before.session.expiresAt) return unavailable();
      return { idHash: result.idHash, authEpoch: result.authEpoch };
    } catch { return unavailable(); }
  }
  /** Close the shared session first, then DB, even if session close is unconfirmed. Success requires both acknowledgments.
   * Captured server metadata allows close after role/epoch reduction. No cross-store atomicity or automatic retry. */
  async revoke(session: AdminSessionRecord, authEpoch: number, policyDigest: string): Promise<void> {
    enabled(this.options.enabled); this.#closed = true;
    let sessionClosed = false;
    try { sessionClosed = await this.options.revokeSession(hash.parse(session.idHash)); } catch { /* Still attempt DB close. */ }
    try {
      const result = z.object({ idHash: hash, revoked: z.literal(true) }).strict().parse(await this.options.transport.rpc("mcp_admin_lease_v1", {
        p_actor: { subject: session.proof.subject, sourceReference: session.proof.identityVersion ?? session.proof.credentialId,
          proofExpiresAt: session.proof.expiresAt, leaseIdHash: hash.parse(session.idHash), authEpoch: epoch.parse(authEpoch), policyDigest: hash.parse(policyDigest) },
        p_request: { action: "revoke", expiresAt: session.expiresAt } }));
      if (result.idHash !== session.idHash || !sessionClosed) return unavailable();
    } catch { return unavailable(); }
  }
}
