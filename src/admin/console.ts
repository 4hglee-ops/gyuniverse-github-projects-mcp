import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadConfig } from "../config.js";
import { bearerToken, publicBaseUrl } from "../oauth/stateless.js";
import { resolveVerifiedOperator, resolveSessionOperator, assertSessionBoundOperator, type OperatorAuthOptions } from "../http/operator-auth.js";
import { boundSessionRecord, createAdminSessionStore, requireSharedAdminSessions, type AdminSessionStore } from "./session-store.js";
import { handleAdminView, type AdminViewRuntime } from "./view-adapter.js";
import { handleAdminManagement, type ManagementRuntime } from "./managed-auth.js";

const cookieName = "__Host-gyp_admin_session", prefix = "/api/admin/v1/";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export interface AdminConsoleRuntime extends AdminViewRuntime { sessionStore?: AdminSessionStore; auth?: OperatorAuthOptions; management?: ManagementRuntime }
export function adminConsoleEnabled(): boolean {
  return process.env.GYP_ADMIN_CONSOLE_ENABLED === "true" && process.env.GYP_ADMIN_SESSION_BRIDGE_ENABLED === "true" && process.env.VERCEL_ENV === "preview";
}
function cookie(token = "", maxAge = 0): string { return `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`; }
function sessionToken(request: Request): string | null {
  const entries = (request.headers.get("cookie") ?? "").split(";").map((v) => v.trim()).filter((v) => v.startsWith(cookieName + "="));
  if (entries.length !== 1) return null;
  const token = entries[0]!.slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function csrf(token: string, key: string) { return createHmac("sha256", key).update("admin-csrf-v1:" + token).digest("base64url"); }
function equal(a: string, b: string) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function json(data: unknown, status = 200) { return Response.json({ ok: true, data }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
async function input(request: Request): Promise<unknown> {
  const reader = request.body?.getReader(); if (!reader) throw new Error("ADMIN_INPUT_INVALID: JSON body is required.");
  let text = "", length = 0; const decoder = new TextDecoder();
  while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength;
    if (length > 32768) { await reader.cancel(); throw new Error("ADMIN_INPUT_INVALID: Request body is too large."); } text += decoder.decode(next.value, { stream: true }); }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new Error("ADMIN_INPUT_INVALID: Request body is invalid JSON."); }
}
/** Preview session/View bridge with a separately gated, server-injected management adapter. */
export async function handleAdminRequest(request: Request, options: AdminConsoleRuntime = {}): Promise<Response> {
  if (!adminConsoleEnabled()) return new Response("Not Found", { status: 404 });
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return new Response("Not Found", { status: 404 });
  if (url.protocol !== "https:" || url.origin !== publicBaseUrl() || (request.method === "POST" && request.headers.get("origin") !== url.origin)) {
    return Response.json({ ok: false, error: { code: "ADMIN_ORIGIN_DENIED" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const path = url.pathname.slice(prefix.length);
  const managementRoute = ["overview", "users", "users/update", "credentials", "credentials/revoke"].includes(path);
  if (managementRoute && process.env.GYP_ADMIN_MANAGEMENT_BRIDGE_ENABLED !== "true") return new Response("Not Found", { status: 404 });
  if (!["overview", "users", "users/update", "credentials", "credentials/revoke", "session", "logout", "identity", "project/catalog", "project/views", "project/views/preview", "write/views/apply", "write/views/update"].includes(path)) return new Response("Not Found", { status: 404 });
  if ((["session"].includes(path) ? !["GET", "POST"].includes(request.method)
    : ["overview", "identity", "project/catalog"].includes(path) ? request.method !== "GET" : request.method !== "POST")) return new Response("Method Not Allowed", { status: 405 });
  let activeStore: AdminSessionStore | undefined, activeHash: string | undefined;
  try {
    const config = options.config ?? loadConfig(), auth = { ...options.auth, currentConfig: options.auth?.currentConfig ?? (() => options.config ?? loadConfig()) };
    const key = auth.bindingKey ?? process.env.MCP_OAUTH_SIGNING_SECRET?.trim() ?? "";
    if (key.length < 32) throw new Error("ADMIN_CONFIG_UNAVAILABLE: A server binding key is required.");
    const store = requireSharedAdminSessions(options.sessionStore ?? createAdminSessionStore(), true);
    activeStore = store;
    if (path === "session" && request.method === "POST") {
      const body = await input(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw new Error("ADMIN_INPUT_INVALID: Session login accepts no identity claims in the body.");
      const operator = await resolveVerifiedOperator(bearerToken(request) ?? "", config, auth); assertSessionBoundOperator(operator);
      if (operator.principal.role !== "admin" || !operator.principal.projectIds.length || !config.allowedOwners.length) throw new Error("PERMISSION_DENIED: An authorized personal Admin is required.");
      if (!(await store.takeLoginSlot(digest(operator.proof.subject)))) throw new Error("ADMIN_RATE_LIMITED: Too many session starts.");
      const token = randomBytes(32).toString("base64url"), csrfToken = csrf(token, key);
      const record = boundSessionRecord(operator, digest(token), digest(csrfToken));
      await store.create(record); activeHash = record.idHash;
      const previous = sessionToken(request); if (previous) await store.revoke(digest(previous));
      // Persistence/rotation may await remote I/O. Never confirm a stale or expired login snapshot.
      const current = await resolveSessionOperator(() => store.get(record.idHash), auth.currentConfig(), auth);
      if (current.principal.role !== "admin" || !current.principal.projectIds.length) throw new Error("PERMISSION_DENIED: Current Admin access is required.");
      const response = json({ authenticated: true, csrf: csrfToken, expiresAt: record.expiresAt });
      response.headers.set("Set-Cookie", cookie(token, record.expiresAt - Math.floor(Date.now() / 1000))); return response;
    }
    const token = sessionToken(request); if (!token) throw new Error("OPERATOR_AUTH_REQUIRED: A session cookie is required.");
    activeHash = digest(token);
    const load = () => store.get(digest(token));
    const refresh = async () => {
      const operator = await resolveSessionOperator(load, options.auth?.currentConfig?.() ?? options.config ?? loadConfig(), auth);
      if (operator.principal.role !== "admin") throw new Error("PERMISSION_DENIED: Admin role was removed.");
      return operator;
    };
    const record = await load();
    if (!record || !equal(record.csrfHash, digest(csrf(token, key)))) throw new Error("OPERATOR_AUTH_REQUIRED: Session binding changed.");
    if (request.method === "POST") {
      const supplied = request.headers.get("x-csrf-token") ?? "";
      if (supplied.length > 200 || !equal(record.csrfHash, digest(supplied))) throw new Error("ADMIN_CSRF_DENIED: Session CSRF proof is required.");
    }
    if (path === "logout") {
      await store.revoke(digest(token)); const response = json({ loggedOut: true }); response.headers.set("Set-Cookie", cookie()); return response;
    }
    const operator = await refresh();
    if (path === "session") return json({ authenticated: true, csrf: csrf(token, key), expiresAt: record.expiresAt });
    if (managementRoute) {
      if (!options.management) throw new Error("ADMIN_MANAGEMENT_UNAVAILABLE: No verified management adapter is installed.");
      return json(await handleAdminManagement(path, request.method, request.method === "POST" ? await input(request) : undefined, refresh, options.management));
    }
    return json(await handleAdminView(path, request.method, request.method === "POST" ? await input(request) : undefined, operator, refresh, options));
  } catch (error) {
    const code = /^([A-Z][A-Z0-9_]+):/.exec(error instanceof Error ? error.message : "")?.[1] ?? "ADMIN_REQUEST_FAILED";
    const status = code === "ADMIN_RATE_LIMITED" ? 429 : code === "OPERATOR_AUTH_REQUIRED" || code === "OPERATOR_REAUTH_REQUIRED" ? 401
      : ["ADMIN_CSRF_DENIED", "ADMIN_PERMISSION_DENIED", "PERMISSION_DENIED", "OPERATOR_IDENTITY_UNAVAILABLE", "PROJECT_MEMBERSHIP_DENIED", "PROJECT_WRITE_NOT_ALLOWED"].includes(code) ? 403
      : code === "ADMIN_INPUT_INVALID" || code === "ADMIN_REQUEST_FAILED" ? 400 : code.startsWith("VIEW_PLAN_") || ["ADMIN_VERSION_CONFLICT", "ADMIN_OPERATION_CONFLICT"].includes(code) ? 409 : 503;
    const response = Response.json({ ok: false, error: { code, retryable: false } }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (status === 401 || code === "OPERATOR_IDENTITY_UNAVAILABLE" || code === "PERMISSION_DENIED") {
      if (activeStore && activeHash) { try { await activeStore.revoke(activeHash); } catch { /* The failed request stays denied; no authentication is returned. */ } }
      response.headers.set("Set-Cookie", cookie());
    }
    return response;
  }
}
