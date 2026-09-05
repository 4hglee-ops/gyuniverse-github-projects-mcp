import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccessTokenPayload,
  AUTH_CODE_TTL_SECONDS,
  AuthorizationCodePayload,
  canonicalMcpResource,
  isAllowedRedirectUri,
  normalizeScope,
  nowSeconds,
  oauthTeamCode,
  OAUTH_READ_SCOPE,
  OAUTH_WRITE_SCOPE,
  publicBaseUrl,
  REFRESH_TOKEN_TTL_SECONDS,
  RefreshTokenPayload,
  RegisteredClientPayload,
  remoteWriteOauthEnabled,
  scopeIncludes,
  scopeIsAllowed,
  sha256Base64Url,
  signEnvelope,
  verifyEnvelope,
} from "./stateless.js";

import {
  MemoryOAuthReplayStore,
  OAuthReplayStore,
} from "./replay-store.js";

interface RegistrationRequest {
  client_name?: string;
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
}

interface AuthorizationParams {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
}

export const authorizationCodeReplayStore: OAuthReplayStore =
  new MemoryOAuthReplayStore();

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: canonicalMcpResource(),
    authorization_servers: [publicBaseUrl()],
    scopes_supported: remoteWriteOauthEnabled()
      ? [OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE]
      : [OAUTH_READ_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(): Record<string, unknown> {
  const base = publicBaseUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: remoteWriteOauthEnabled()
      ? [OAUTH_READ_SCOPE, OAUTH_WRITE_SCOPE]
      : [OAUTH_READ_SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
  };
}

function noStoreJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return Response.json(body, { ...init, headers });
}

function tokenError(error: string, description: string, status = 400): Response {
  return noStoreJson({ error, error_description: description }, { status });
}

export async function registerOAuthClient(request: Request): Promise<Response> {
  let body: RegistrationRequest;
  try {
    body = (await request.json()) as RegistrationRequest;
  } catch {
    return noStoreJson({ error: "invalid_client_metadata" }, { status: 400 });
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (redirectUris.length === 0 || !redirectUris.every(isAllowedRedirectUri)) {
    return noStoreJson(
      { error: "invalid_redirect_uri", error_description: "Unsupported redirect URI." },
      { status: 400 },
    );
  }

  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
    return noStoreJson(
      { error: "invalid_client_metadata", error_description: "Only public PKCE clients are supported." },
      { status: 400 },
    );
  }

  const requestedGrants = body.grant_types ?? ["authorization_code", "refresh_token"];
  if (requestedGrants.some((grant) => grant !== "authorization_code" && grant !== "refresh_token")) {
    return noStoreJson({ error: "invalid_client_metadata" }, { status: 400 });
  }
  if (!requestedGrants.includes("authorization_code")) {
    return noStoreJson({ error: "invalid_client_metadata" }, { status: 400 });
  }
  if (body.response_types?.some((type) => type !== "code")) {
    return noStoreJson({ error: "invalid_client_metadata" }, { status: 400 });
  }

  const payload: RegisteredClientPayload = {
    typ: "registered_client",
    redirectUris,
    clientName: body.client_name?.slice(0, 120),
    iat: nowSeconds(),
  };
  const clientId = await signEnvelope("gyprc", payload);

  return noStoreJson(
    {
      client_id: clientId,
      client_id_issued_at: payload.iat,
      client_name: payload.clientName ?? "Gyuniverse GitHub Projects MCP client",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: requestedGrants,
      response_types: ["code"],
    },
    { status: 201 },
  );
}

function paramsFromUrl(url: URL): AuthorizationParams {
  return {
    responseType: url.searchParams.get("response_type") ?? "",
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    state: url.searchParams.get("state") ?? "",
    codeChallenge: url.searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? "",
    resource: url.searchParams.get("resource") ?? "",
    scope: normalizeScope(url.searchParams.get("scope")),
  };
}

async function paramsFromForm(request: Request): Promise<{ params: AuthorizationParams; teamCode: string }> {
  const form = await request.formData();
  return {
    params: {
      responseType: String(form.get("response_type") ?? ""),
      clientId: String(form.get("client_id") ?? ""),
      redirectUri: String(form.get("redirect_uri") ?? ""),
      state: String(form.get("state") ?? ""),
      codeChallenge: String(form.get("code_challenge") ?? ""),
      codeChallengeMethod: String(form.get("code_challenge_method") ?? ""),
      resource: String(form.get("resource") ?? ""),
      scope: normalizeScope(String(form.get("scope") ?? "")),
    },
    teamCode: String(form.get("team_code") ?? ""),
  };
}

async function validateAuthorization(params: AuthorizationParams): Promise<string | null> {
  if (params.responseType !== "code") return "Only response_type=code is supported.";
  if (!params.clientId || !params.redirectUri || !params.codeChallenge) return "Missing required OAuth parameters.";
  if (params.codeChallengeMethod !== "S256") return "PKCE S256 is required.";
  if (params.resource !== canonicalMcpResource()) return "Invalid resource parameter.";
  if (!scopeIsAllowed(params.scope)) return "Unsupported or disabled scope.";

  const client = await verifyEnvelope<RegisteredClientPayload>(params.clientId, "gyprc");
  if (!client || client.typ !== "registered_client") return "Invalid client_id.";
  if (!client.redirectUris.includes(params.redirectUri)) return "redirect_uri was not registered for this client.";
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function approvalPage(params: AuthorizationParams, error?: string): Response {
  const hidden = [
    ["response_type", params.responseType],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["state", params.state],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", params.codeChallengeMethod],
    ["resource", params.resource],
    ["scope", params.scope],
  ]
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join("\n");

  const writeRequested = scopeIncludes(params.scope, OAUTH_WRITE_SCOPE);
  const scopeDescription = writeRequested
    ? "GitHub Projects 읽기와, 서버의 별도 write gate가 허용하는 Status/Priority 등 Project 변경"
    : "GitHub Projects 읽기 및 상태 분석";
  const warning = writeRequested
    ? "<p><strong>쓰기 scope가 요청되었습니다.</strong> OAuth 승인만으로 쓰기가 활성화되지는 않으며, 서버 write gate와 Project allowlist도 모두 충족해야 합니다.</p>"
    : "<p><strong>이 연결은 OAuth 기준 read-only입니다.</strong></p>";
  const errorHtml = error ? `<p style="color:#b42318;font-weight:600">${escapeHtml(error)}</p>` : "";

  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gyuniverse Projects 연결 승인</title></head><body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;margin:0;padding:32px;color:#111827"><main style="max-width:560px;margin:48px auto;background:white;padding:28px;border-radius:14px;border:1px solid #e5e7eb"><h1 style="font-size:22px;margin-top:0">Gyuniverse GitHub Projects 연결 승인</h1><p>연결하려는 AI 클라이언트가 다음 범위에 접근하려고 합니다.</p><p>${escapeHtml(scopeDescription)}</p>${warning}${errorHtml}<form method="post" action="/oauth/authorize">${hidden}<label style="display:block;font-weight:600;margin:18px 0 8px">팀 접근 코드</label><input type="password" name="team_code" autocomplete="off" required style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px"><button type="submit" style="margin-top:18px;padding:10px 16px;border:0;border-radius:8px;background:#111827;color:white;font-weight:600">연결 승인</button></form></main></body></html>`,
    {
      status: error ? 403 : 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );
}

export async function authorizeOAuth(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const params = paramsFromUrl(new URL(request.url));
    const error = await validateAuthorization(params);
    if (error) return new Response(error, { status: 400 });
    return approvalPage(params);
  }

  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let parsed: { params: AuthorizationParams; teamCode: string };
  try {
    parsed = await paramsFromForm(request);
  } catch {
    return new Response("Invalid form submission.", { status: 400 });
  }

  const error = await validateAuthorization(parsed.params);
  if (error) return new Response(error, { status: 400 });

  const expectedTeamCode = oauthTeamCode();
  if (!expectedTeamCode || parsed.teamCode !== expectedTeamCode) {
    return approvalPage(parsed.params, "팀 접근 코드가 올바르지 않습니다.");
  }

  const now = nowSeconds();
  const payload: AuthorizationCodePayload = {
    typ: "authorization_code",
    clientId: parsed.params.clientId,
    redirectUri: parsed.params.redirectUri,
    resource: parsed.params.resource,
    scope: parsed.params.scope,
    codeChallenge: parsed.params.codeChallenge,
    iat: now,
    exp: now + AUTH_CODE_TTL_SECONDS,
  };
  const code = await signEnvelope("gypac", payload);
  const redirect = new URL(parsed.params.redirectUri);
  redirect.searchParams.set("code", code);
  if (parsed.params.state) redirect.searchParams.set("state", parsed.params.state);
  redirect.searchParams.set("iss", publicBaseUrl());
  return Response.redirect(redirect.toString(), 303);
}

async function issueTokens(resource: string, scope: string, clientId: string): Promise<Response> {
  const now = nowSeconds();
  const accessPayload: AccessTokenPayload = {
    typ: "access_token",
    aud: resource,
    scope,
    sub: "gyuniverse-projects-team",
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
  const refreshPayload: RefreshTokenPayload = {
    typ: "refresh_token",
    aud: resource,
    scope,
    clientId,
    sub: "gyuniverse-projects-team",
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
  };
  const [accessToken, refreshToken] = await Promise.all([
    signEnvelope("gypa", accessPayload),
    signEnvelope("gyprf", refreshPayload),
  ]);
  return noStoreJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  });
}

async function handleAuthorizationCode(form: FormData): Promise<Response> {
  const code = String(form.get("code") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const codeVerifier = String(form.get("code_verifier") ?? "");
  const resource = String(form.get("resource") ?? "");

  if (!code || !clientId || !redirectUri || !codeVerifier || !resource) {
    return tokenError("invalid_request", "Missing required token request parameters.");
  }
  if (resource !== canonicalMcpResource()) return tokenError("invalid_target", "Unexpected resource parameter.");

  const payload = await verifyEnvelope<AuthorizationCodePayload>(code, "gypac");
  if (!payload || payload.typ !== "authorization_code") return tokenError("invalid_grant", "Authorization code is invalid.");
  if (payload.exp <= nowSeconds()) return tokenError("invalid_grant", "Authorization code expired.");
  if (payload.clientId !== clientId) return tokenError("invalid_grant", "client_id mismatch.");
  if (payload.redirectUri !== redirectUri) return tokenError("invalid_grant", "redirect_uri mismatch.");
  if (payload.resource !== resource) return tokenError("invalid_grant", "resource mismatch.");

  const actualChallenge = await sha256Base64Url(codeVerifier);
  if (actualChallenge !== payload.codeChallenge) return tokenError("invalid_grant", "PKCE verification failed.");
  if (!authorizationCodeReplayStore.consume(code, payload.exp)) {
    return tokenError("invalid_grant", "Authorization code has already been used.");
  }

  return issueTokens(payload.resource, payload.scope, payload.clientId);
}

async function handleRefreshToken(form: FormData): Promise<Response> {
  const refreshToken = String(form.get("refresh_token") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const resource = String(form.get("resource") ?? "");

  if (!refreshToken || !clientId || !resource) return tokenError("invalid_request", "Missing refresh token request parameters.");
  if (resource !== canonicalMcpResource()) return tokenError("invalid_target", "Unexpected resource parameter.");

  const payload = await verifyEnvelope<RefreshTokenPayload>(refreshToken, "gyprf");
  if (!payload || payload.typ !== "refresh_token") return tokenError("invalid_grant", "Refresh token is invalid.");
  if (payload.exp <= nowSeconds()) return tokenError("invalid_grant", "Refresh token expired.");
  if (payload.clientId !== clientId) return tokenError("invalid_grant", "client_id mismatch.");
  if (payload.aud !== resource) return tokenError("invalid_grant", "resource mismatch.");
  if (!scopeIsAllowed(payload.scope)) return tokenError("invalid_scope", "Token scope is no longer enabled.");

  return issueTokens(payload.aud, payload.scope, payload.clientId);
}

export async function tokenOAuth(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return tokenError("invalid_request", "Expected application/x-www-form-urlencoded body.");
  }
  const grantType = String(form.get("grant_type") ?? "");
  if (grantType === "authorization_code") return handleAuthorizationCode(form);
  if (grantType === "refresh_token") return handleRefreshToken(form);
  return tokenError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token.");
}
