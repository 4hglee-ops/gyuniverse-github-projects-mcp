const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const OAUTH_READ_SCOPE = "projects:read";
export const OAUTH_WRITE_SCOPE = "projects:write";
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_CODE_TTL_SECONDS = 120;

export interface RegisteredClientPayload {
  typ: "registered_client";
  redirectUris: string[];
  clientName?: string;
  iat: number;
}

export interface AuthorizationCodePayload {
  typ: "authorization_code";
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  codeChallenge: string;
  iat: number;
  exp: number;
}

export interface AccessTokenPayload {
  typ: "access_token";
  aud: string;
  scope: string;
  sub: "gyuniverse-projects-team";
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  typ: "refresh_token";
  aud: string;
  scope: string;
  clientId: string;
  sub: "gyuniverse-projects-team";
  iat: number;
  exp: number;
}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function publicBaseUrl(): string {
  const configured = env("PUBLIC_BASE_URL");
  if (configured) return configured.replace(/\/$/, "");

  const previewHost = env("VERCEL_URL");
  if (previewHost) return `https://${previewHost}`;

  return "http://localhost:3000";
}

export function canonicalMcpResource(): string {
  return `${publicBaseUrl()}/mcp`;
}

export function oauthTeamCode(): string | null {
  return env("MCP_OAUTH_TEAM_CODE");
}

function signingSecret(): string | null {
  return env("MCP_OAUTH_SIGNING_SECRET");
}

export function remoteWriteOauthEnabled(): boolean {
  return process.env.MCP_OAUTH_WRITE_ENABLED === "true";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = signingSecret();
  if (!secret) return null;
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signEnvelope(prefix: string, payload: object): Promise<string> {
  const key = await hmacKey();
  if (!key) throw new Error("OAuth signing secret is not configured.");
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const message = `${prefix}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return `${message}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyEnvelope<T>(token: string, prefix: string): Promise<T | null> {
  const [actualPrefix, body, signature] = token.split(".");
  if (actualPrefix !== prefix || !body || !signature) return null;
  const key = await hmacKey();
  if (!key) return null;
  const message = `${actualPrefix}.${body}`;
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signature),
    encoder.encode(message),
  );
  if (!valid) return null;
  try {
    return JSON.parse(decoder.decode(base64UrlToBytes(body))) as T;
  } catch {
    return null;
  }
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function parseScope(scope: string | null): string[] {
  return (scope ?? "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeScope(scope: string | null): string {
  const requested = parseScope(scope);
  if (requested.length === 0) return OAUTH_READ_SCOPE;
  return [...new Set(requested)].sort().join(" ");
}

export function scopeIsAllowed(scope: string | null): boolean {
  const requested = parseScope(normalizeScope(scope));
  if (!requested.includes(OAUTH_READ_SCOPE)) return false;
  if (requested.some((value) => value !== OAUTH_READ_SCOPE && value !== OAUTH_WRITE_SCOPE)) return false;
  if (requested.includes(OAUTH_WRITE_SCOPE) && !remoteWriteOauthEnabled()) return false;
  return true;
}

export function scopeIncludes(scope: string, expected: string): boolean {
  return parseScope(scope).includes(expected);
}

export function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;

    if (
      url.protocol === "https:" &&
      (url.hostname === "claude.ai" || url.hostname === "claude.com") &&
      url.pathname === "/api/mcp/auth_callback"
    ) return true;

    if (
      url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      url.pathname === "/connector_platform_oauth_redirect"
    ) return true;

    if (
      url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      /^\/connector\/oauth\/[^/]+$/.test(url.pathname)
    ) return true;

    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) return true;

    return false;
  } catch {
    return false;
  }
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function oauthAccessTokenPayload(token: string): Promise<AccessTokenPayload | null> {
  const payload = await verifyEnvelope<AccessTokenPayload>(token, "gypa");
  if (!payload || payload.typ !== "access_token") return null;
  if (payload.exp <= nowSeconds()) return null;
  if (payload.aud !== canonicalMcpResource()) return null;
  if (!scopeIncludes(payload.scope, OAUTH_READ_SCOPE)) return null;
  return payload;
}
