import { createMcpHandler } from "@modelcontextprotocol/server";
import { traceMcpRequest } from "./mcp-diagnostics.js";
import { shouldUseLegacyJsonTransport, serveLegacyJsonTransport } from "./legacy-json-transport.js";

import { type AppConfig, loadConfig } from "../config.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { resolveVerifiedOperator, operatorConfig, operatorViewWriteGuard, type OperatorAuthOptions } from "./operator-auth.js";
import type { BuildServerOptions } from "../mcp/build-server.js";
import {
  type AuthenticatedPrincipal,
  principalForRole,
} from "../core/identity/principal.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { buildMcpServer } from "../mcp/build-server.js";
import {
  bearerToken,
  oauthAccessTokenPayload,
  OAUTH_READ_SCOPE,
  OAUTH_WRITE_SCOPE,
  publicBaseUrl,
  remoteWriteOauthEnabled,
  scopeIncludes,
} from "../oauth/stateless.js";

const LEGACY_TEAM_SUBJECT = "gyuniverse-projects-team";

export function oauthChallengeScope(): string {
  return remoteWriteOauthEnabled()
    ? `${OAUTH_READ_SCOPE} ${OAUTH_WRITE_SCOPE}`
    : OAUTH_READ_SCOPE;
}

function unauthorized(): Response {
  const metadata = `${publicBaseUrl()}/.well-known/oauth-protected-resource`;
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer realm="gyuniverse-github-projects-mcp", resource_metadata="${metadata}", scope="${oauthChallengeScope()}"`,
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

export function resolveRemotePrincipal(
  subject: string,
  config: AppConfig,
  registry = OAuthIdentityRegistry.fromEnvironment(),
): AuthenticatedPrincipal | null {
  const individual = registry.resolvePrincipal(subject);
  if (individual) return individual;

  if (subject !== LEGACY_TEAM_SUBJECT) return null;
  return principalForRole(subject, "viewer", {
    source: "oauth",
    displayName: "Legacy team OAuth principal (read-only)",
    projectIds: config.allowedProjectIds,
  });
}

export async function handleRemoteMcpRequest(
  request: Request,
  options?: {
    config?: AppConfig;
    client?: GitHubGraphQlClient;
    auth?: OperatorAuthOptions;
    restClient?: BuildServerOptions["restClient"];
    viewPlanStore?: BuildServerOptions["viewPlanStore"];
  },
): Promise<Response> {
  return traceMcpRequest(request, async (mark) => {
  const presentedToken = bearerToken(request);
  if (!presentedToken) return unauthorized();

  const access = await oauthAccessTokenPayload(presentedToken);
  if (!access) return unauthorized();
  mark("oauth_verified");

  const baseConfig = options?.config ?? loadConfig();
  const auth = { ...options?.auth, currentConfig: options?.auth?.currentConfig ?? (() => options?.config ?? loadConfig()) };
  let operator;
  try { operator = await resolveVerifiedOperator(presentedToken, baseConfig, auth); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("TEAM_ACL_UNAVAILABLE:"))
      return new Response("Authorization unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    return unauthorized();
  }
  mark("principal_resolved"); mark("acl_resolved");
  const effectiveConfig = operatorConfig(operator), principal = operator.principal;
  const client = options?.client ?? new GitHubGraphQlClient(effectiveConfig.githubToken);
  const assertCurrentWrite = operatorViewWriteGuard(operator, auth);
  const factory = () => buildMcpServer({ config: effectiveConfig, client, principal, assertCurrentWrite,
    restClient: options?.restClient, viewPlanStore: options?.viewPlanStore });
  mark("sdk_dispatch");
  if (await shouldUseLegacyJsonTransport(request)) {
    return serveLegacyJsonTransport(request, factory);
  }
  const handler = createMcpHandler(factory);
  return handler.fetch(request);
  });
}
