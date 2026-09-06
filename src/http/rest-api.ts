import { z } from "zod";

import { loadConfig } from "../config.js";
import { IdentityContextService } from "../core/identity/identity-context-service.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { ProjectService } from "../core/projects/project-service.js";
import { HighLevelReadService } from "../core/reads/high-level-read-service.js";
import { SnapshotService } from "../core/snapshots/snapshot-service.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import {
  bearerToken,
  oauthAccessTokenPayload,
  OAUTH_READ_SCOPE,
  scopeIncludes,
} from "../oauth/stateless.js";
import { configForRemoteScope, resolveRemotePrincipal } from "./remote-mcp.js";

const projectInput = z.object({
  owner: z.string().min(1),
  number: z.number().int().min(1),
  first: z.number().int().min(1).max(100).default(100),
  includeArchived: z.boolean().default(false),
});

const myWorkInput = projectInput.extend({
  includeDone: z.boolean().default(false),
});

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]+):/.exec(message);
  return match?.[1] ?? "REST_REQUEST_FAILED";
}

function errorResponse(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error);
  return json({ ok: false, error: { code: errorCode(error), message } }, status);
}

function unauthorized(): Response {
  return json({
    ok: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid OAuth bearer token with projects:read scope is required.",
    },
  }, 401);
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("INVALID_JSON: Request body must be valid JSON.");
  }
}

export async function handleRestApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return new Response("Not Found", { status: 404 });

  const token = bearerToken(request);
  if (!token) return unauthorized();

  const access = await oauthAccessTokenPayload(token);
  if (!access || !scopeIncludes(access.scope, OAUTH_READ_SCOPE)) return unauthorized();

  const baseConfig = loadConfig();
  const config = configForRemoteScope(baseConfig, access.scope);
  const principal = resolveRemotePrincipal(
    access.sub,
    config,
    OAuthIdentityRegistry.fromEnvironment(),
  );
  if (!principal) return unauthorized();

  const client = new GitHubGraphQlClient(config.githubToken);
  const projects = new ProjectService({ config, client, principal });
  const snapshots = new SnapshotService(projects);
  const reads = new HighLevelReadService(snapshots);
  const identity = new IdentityContextService(principal);

  try {
    if (url.pathname === "/api/v1/identity") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
      return json({ ok: true, data: identity.getContext() });
    }

    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const body = await requestBody(request);

    if (url.pathname === "/api/v1/project/brief") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getProjectBrief(input.owner, input.number, input) });
    }

    if (url.pathname === "/api/v1/project/backlog") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getBacklog(input.owner, input.number, input) });
    }

    if (url.pathname === "/api/v1/project/review-queue") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getReviewQueue(input.owner, input.number, input) });
    }

    if (url.pathname === "/api/v1/project/unassigned") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getUnassignedWork(input.owner, input.number, input) });
    }

    if (url.pathname === "/api/v1/project/blockers") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getBlockers(input.owner, input.number, input) });
    }

    if (url.pathname === "/api/v1/project/my-work") {
      const input = myWorkInput.parse(body);
      const login = principal.githubLogin?.trim();
      if (!login) {
        throw new Error(`IDENTITY_GITHUB_LOGIN_REQUIRED: Principal '${principal.id}' has no GitHub login mapping.`);
      }
      return json({
        ok: true,
        data: await reads.getMyWork(input.owner, input.number, {
          ...input,
          login,
        }),
      });
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Request input failed validation.",
          issues: error.issues,
        },
      }, 400);
    }
    return errorResponse(error);
  }
}
