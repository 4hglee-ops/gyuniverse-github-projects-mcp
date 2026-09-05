import { createMcpHandler } from "@modelcontextprotocol/server";

import { type AppConfig, loadConfig } from "../config.js";
import { principalForRole } from "../core/identity/principal.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { buildMcpServer } from "../mcp/build-server.js";
import {
  bearerToken,
  oauthAccessTokenPayload,
  OAUTH_READ_SCOPE,
  OAUTH_WRITE_SCOPE,
  publicBaseUrl,
  scopeIncludes,
} from "../oauth/stateless.js";

function unauthorized(): Response {
  const metadata = `${publicBaseUrl()}/.well-known/oauth-protected-resource`;
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer realm="gyuniverse-github-projects-mcp", resource_metadata="${metadata}", scope="${OAUTH_READ_SCOPE}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function configForRemoteScope(config: AppConfig, scope: string): AppConfig {
  const oauthWriteAllowed = scopeIncludes(scope, OAUTH_WRITE_SCOPE);
  return {
    ...config,
    writeEnabled: config.writeEnabled && oauthWriteAllowed,
  };
}

export async function handleRemoteMcpRequest(
  request: Request,
  options?: {
    config?: AppConfig;
    client?: GitHubGraphQlClient;
  },
): Promise<Response> {
  const presentedToken = bearerToken(request);
  if (!presentedToken) return unauthorized();

  const access = await oauthAccessTokenPayload(presentedToken);
  if (!access) return unauthorized();

  const baseConfig = options?.config ?? loadConfig();
  const effectiveConfig = configForRemoteScope(baseConfig, access.scope);
  const client = options?.client ?? new GitHubGraphQlClient(effectiveConfig.githubToken);

  // M7 first slice: preserve the current shared-team OAuth subject while making
  // principal/permission checks real at the Shared Core boundary. A write-scoped
  // legacy team token keeps the pre-M7 write surface for compatibility. Individual
  // subjects and per-user roles replace this shared principal in the next M7 slice.
  const principal = scopeIncludes(access.scope, OAUTH_WRITE_SCOPE)
    ? principalForRole(access.sub, "admin", { source: "oauth", displayName: "Legacy team OAuth principal" })
    : principalForRole(access.sub, "viewer", { source: "oauth", displayName: "Legacy team OAuth principal" });

  const handler = createMcpHandler(() => buildMcpServer({
    config: effectiveConfig,
    client,
    principal,
  }));
  return handler.fetch(request);
}
