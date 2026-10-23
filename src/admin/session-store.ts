import { z } from "zod";
import { assertSessionBoundOperator, type VerifiedOperator } from "../http/operator-auth.js";
import { OAUTH_READ_SCOPE, scopeIncludes } from "../oauth/stateless.js";
import { createSharedUpstashRedis } from "../core/persistence/upstash.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const proofSchema = z.object({ subject: z.string().min(1).max(256), scope: z.string().max(200), expiresAt: z.number().int().positive(),
  source: z.enum(["env", "managed"]), identityVersion: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), credentialId: z.uuid().optional() }).strict()
  .refine((p) => scopeIncludes(p.scope, OAUTH_READ_SCOPE) && (p.source === "env"
    ? !!p.identityVersion && !p.credentialId && p.subject !== "gyuniverse-projects-team" && !p.subject.startsWith("user:managed:")
    : !!p.credentialId && !p.identityVersion && p.subject.startsWith("user:managed:") && z.uuid().safeParse(p.subject.slice("user:managed:".length)).success));
const sessionSchema = z.object({ version: z.literal(1), idHash: hash, csrfHash: hash, proof: proofSchema,
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(), revokedAt: z.number().int().nonnegative().nullable() }).strict()
  .refine((s) => s.expiresAt > s.createdAt && s.expiresAt <= Math.min(s.proof.expiresAt, s.createdAt + 900));
export type AdminSessionRecord = z.infer<typeof sessionSchema>;
function validateSession(raw: unknown): AdminSessionRecord {
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) throw new Error("ADMIN_SESSION_INVALID: Session metadata failed validation.");
  return parsed.data;
}
export interface AdminSessionStore {
  readonly persistence: "process-local" | "shared";
  create(session: AdminSessionRecord): Promise<void>;
  get(idHash: string): Promise<AdminSessionRecord | null>;
  revoke(idHash: string): Promise<boolean>;
  takeLoginSlot(actorHash: string): Promise<boolean>;
}
/** Metadata only. This does not mint a token/cookie or retain the presented bearer. */
export function boundSessionRecord(operator: VerifiedOperator, idHash: string, csrfHash: string, now = Math.floor(Date.now() / 1000)): AdminSessionRecord {
  assertSessionBoundOperator(operator, now);
  return validateSession({ version: 1, idHash, csrfHash, proof: operator.proof, createdAt: now,
    expiresAt: Math.min(operator.proof.expiresAt, now + 900), revokedAt: null });
}
/** Contract double for local development/tests. Not a deployed session implementation. */
export class MemoryAdminSessionStore implements AdminSessionStore {
  readonly persistence = "process-local";
  private readonly records = new Map<string, AdminSessionRecord>();
  private readonly attempts = new Map<string, number>();
  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}
  async create(raw: AdminSessionRecord): Promise<void> {
    const session = validateSession(raw), now = this.now();
    if (session.revokedAt !== null || session.createdAt > now || session.expiresAt <= now) throw new Error("ADMIN_SESSION_INVALID: Session must be currently valid.");
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id);
    if (this.records.size >= 1000 || this.records.has(session.idHash)) throw new Error("ADMIN_SESSION_CONFLICT: Session cannot be created.");
    this.records.set(session.idHash, structuredClone(session));
  }
  async get(idHash: string): Promise<AdminSessionRecord | null> {
    hash.parse(idHash);
    const record = this.records.get(idHash);
    const now = this.now();
    return !record || record.revokedAt !== null || record.createdAt > now || record.expiresAt <= now ? null : structuredClone(record);
  }
  async revoke(idHash: string): Promise<boolean> {
    hash.parse(idHash);
    const record = this.records.get(idHash);
    if (!record) return false;
    if (record.revokedAt === null) this.records.set(idHash, { ...record, revokedAt: this.now() });
    return true;
  }
  async takeLoginSlot(actorHash: string): Promise<boolean> {
    hash.parse(actorHash);
    const slot = Math.floor(this.now() / 600), key = slot + ":" + actorHash;
    for (const old of this.attempts.keys()) if (!old.startsWith(slot + ":")) this.attempts.delete(old);
    const count = (this.attempts.get(key) ?? 0) + 1; this.attempts.set(key, count); return count <= 8;
  }
}

export interface AdminSessionRedis {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { nx: true; ex: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
}
const REVOKE = `-- ADMIN_SESSION_REVOKE
local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
local s = cjson.decode(raw); if s.idHash ~= ARGV[1] then return -1 end
if s.revokedAt ~= cjson.null then return 1 end
s.revokedAt = tonumber(ARGV[2]); redis.call('SET', KEYS[1], cjson.encode(s), 'KEEPTTL'); return 1`;
const LOGIN = `-- ADMIN_LOGIN_SLOT
local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 600) end; return n`;
/** Shared adapter; tests use a contract double. Actual Redis/Lua execution is a separate verification gate. */
export class RedisAdminSessionStore implements AdminSessionStore {
  readonly persistence = "shared";
  constructor(private readonly redis: AdminSessionRedis, private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}
  private key(idHash: string) {
    if (!hash.safeParse(idHash).success) throw new Error("ADMIN_SESSION_INVALID: Invalid session reference.");
    return "gyuniverse:admin:v1:session:" + idHash;
  }
  private async command<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch { throw new Error("ADMIN_SESSION_STORE_UNAVAILABLE: Shared session storage failed."); }
  }
  async create(raw: AdminSessionRecord): Promise<void> {
    const session = validateSession(raw), now = this.now();
    if (session.revokedAt !== null || session.createdAt > now || session.expiresAt <= now) throw new Error("ADMIN_SESSION_INVALID: Session must be currently valid.");
    if (await this.command(() => this.redis.set(this.key(session.idHash), JSON.stringify(session), { nx: true, ex: session.expiresAt - now })) !== "OK") {
      throw new Error("ADMIN_SESSION_CONFLICT: Session creation was not confirmed.");
    }
  }
  async get(idHash: string): Promise<AdminSessionRecord | null> {
    const key = this.key(idHash), raw = await this.command(() => this.redis.get(key));
    if (raw === null || raw === undefined) return null;
    let decoded = raw;
    try { if (typeof raw === "string") decoded = JSON.parse(raw); } catch { throw new Error("ADMIN_SESSION_INVALID: Stored session is not JSON."); }
    const session = validateSession(decoded), now = this.now();
    if (session.idHash !== idHash) throw new Error("ADMIN_SESSION_INVALID: Stored session reference changed.");
    return session.revokedAt !== null || session.createdAt > now || session.expiresAt <= now ? null : session;
  }
  async revoke(idHash: string): Promise<boolean> {
    const key = this.key(idHash), result = Number(await this.command(() => this.redis.eval(REVOKE, [key], [idHash, this.now()])));
    if (result !== 0 && result !== 1) throw new Error("ADMIN_SESSION_INVALID: Session revocation was not confirmed.");
    return result === 1;
  }
  async takeLoginSlot(actorHash: string): Promise<boolean> {
    if (!hash.safeParse(actorHash).success) throw new Error("ADMIN_SESSION_INVALID: Invalid login reference.");
    const key = "gyuniverse:admin:v1:login:" + Math.floor(this.now() / 600) + ":" + actorHash;
    const count = Number(await this.command(() => this.redis.eval(LOGIN, [key], [])));
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("ADMIN_SESSION_STORE_UNAVAILABLE: Login limiter failed.");
    return count <= 8;
  }
}
export function createAdminSessionStore(): AdminSessionStore {
  try { return new RedisAdminSessionStore(createSharedUpstashRedis()); }
  catch { throw new Error("ADMIN_SESSION_STORE_UNAVAILABLE: Shared admin session storage must be configured."); }
}
export function requireSharedAdminSessions(store: AdminSessionStore, deployed = ["preview", "production"].includes(process.env.VERCEL_ENV ?? "") || process.env.NODE_ENV === "production"): AdminSessionStore {
  if (deployed && store.persistence !== "shared") throw new Error("ADMIN_SESSION_DURABILITY_REQUIRED: Deployed admin sessions require shared storage.");
  return store;
}
