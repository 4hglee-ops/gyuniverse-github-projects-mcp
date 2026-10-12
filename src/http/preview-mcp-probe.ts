import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { canonicalMcpResource, nowSeconds, signEnvelope, type AccessTokenPayload } from "../oauth/stateless.js";
import { handleRemoteMcpRequest } from "./remote-mcp.js";
import type { AppConfig } from "../config.js";

/**
 * A deliberately isolated, opt-in Vercel Preview smoke test.
 *
 * It makes real HTTP-shaped POST requests through the Remote MCP SDK and
 * validates signed OAuth bearer authentication, but never performs GitHub API
 * calls, never exposes an access code or token and never changes project data.
 * Vercel Preview Deployment Protection remains active.
 */
const SUBJECT = "user:mcp-preview-transport-probe";
const PROJECT_ID = "PVT_PREVIEW_PROBE_ONLY";
const LIMIT_MS = 6_000;

export function previewMcpProbeEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview" &&
    process.env.MCP_PREVIEW_TRANSPORT_PROBE_ENABLED === "true" &&
    process.env.MCP_HTTP_DIAGNOSTICS_ENABLED === "true";
}

type Step = "initialize" | "tools/list" | "tools/call";
interface StepResult {
  step: Step;
  status: "ok" | "error" | "timeout";
  httpStatus: number | null;
  responseType: "json" | "sse" | "other" | null;
  durationMs: number;
}

class NoUpstreamGitHub extends GitHubGraphQlClient {
  constructor() { super("preview-probe-no-github-token"); }
  override async request<T>(): Promise<T> {
    throw new Error("PREVIEW_PROBE_GITHUB_ACCESS_BLOCKED");
  }
}

function probeConfig(): AppConfig {
  return {
    githubToken: "preview-probe-no-github-token",
    allowedOwners: ["preview-probe-no-real-owner"],
    allowedProjectIds: [PROJECT_ID],
    writeEnabled: false,
  };
}

function probeIdentityReady(): boolean {
  try {
    const principal = OAuthIdentityRegistry.fromEnvironment().resolvePrincipal(SUBJECT);
    return principal?.role === "viewer" &&
      principal.projectIds.length === 1 &&
      principal.projectIds[0] === PROJECT_ID &&
      principal.permissions.length === 1 &&
      principal.permissions[0] === "project.read";
  } catch {
    return false;
  }
}

async function probeStep(
  step: Step,
  payload: unknown,
  token: string,
  sessionId?: string,
): Promise<{ result: StepResult; sessionId?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let httpStatus: number | null = null;
  let responseType: StepResult["responseType"] = null;
  let didTimeOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      didTimeOut = true;
      controller.abort();
      reject(new Error("PREVIEW_PROBE_TIMEOUT"));
    }, LIMIT_MS);
    timer.unref?.();
  });

  try {
    const request = new Request(canonicalMcpResource(), {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    // This is the real MCP HTTP handler and SDK dispatch, not a mocked route.
    const response = await Promise.race([
      handleRemoteMcpRequest(request, { config: probeConfig(), client: new NoUpstreamGitHub() }),
      deadline,
    ]);
    httpStatus = response.status;
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    responseType = type.includes("text/event-stream") ? "sse" :
      type.includes("application/json") ? "json" : "other";
    const returnedSessionId = response.headers.get("mcp-session-id") ?? undefined;

    if (!response.body || response.status !== 200) {
      return {
        result: { step, status: "error", httpStatus, responseType, durationMs: Date.now() - started },
        sessionId: returnedSessionId,
      };
    }

    reader = response.body.getReader();
    let body = "";
    let isOk = false;
    for (let i = 0; i < 30 && body.length < 512_000; i++) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      body += new TextDecoder().decode(chunk.value);
      // A single complete JSON-RPC result (possibly wrapped in SSE) is enough;
      // do not wait for an intentionally long-lived SSE connection to close.
      if (body.includes('"jsonrpc"') && body.includes('"result"') && !body.includes('"error"')) {
        isOk = true;
        break;
      }
      if (body.includes('"jsonrpc"') && body.includes('"error"')) break;
    }

    return {
      result: { step, status: isOk ? "ok" : "error", httpStatus, responseType, durationMs: Date.now() - started },
      sessionId: returnedSessionId,
    };
  } catch {
    return {
      result: { step, status: didTimeOut ? "timeout" : "error", httpStatus, responseType, durationMs: Date.now() - started },
    };
  } finally {
    controller.abort();
    if (timer) clearTimeout(timer);
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function handlePreviewMcpProbe(): Promise<Response> {
  if (!previewMcpProbeEnabled()) return new Response("Not Found", { status: 404 });
  if (!probeIdentityReady() || process.env.M12_TEAM_ACL_MODE === "enforce") {
    return Response.json(
      { ok: false, reason: "preview_probe_not_configured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = nowSeconds();
  const token = await signEnvelope("gypa", {
    typ: "access_token",
    aud: canonicalMcpResource(),
    scope: "projects:read",
    sub: SUBJECT,
    iat: now,
    exp: now + 60,
  } satisfies AccessTokenPayload);

  const first = await probeStep("initialize", {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "preview-transport-probe", version: "1.0" },
    },
  }, token);

  const steps: StepResult[] = [first.result];
  if (first.result.status === "ok") {
    const second = await probeStep("tools/list", {
      jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
    }, token, first.sessionId);
    steps.push(second.result);

    if (second.result.status === "ok") {
      const third = await probeStep("tools/call", {
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "get_identity_context", arguments: {} },
      }, token, first.sessionId);
      steps.push(third.result);
    }
  }

  const requireJson = process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED === "true";
  return Response.json(
    { ok: steps.length === 3 && steps.every(s => s.status === "ok" && (!requireJson || s.responseType === "json")), mode: "preview_only", upstreamGitHub: "disabled", steps },
    { headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } },
  );
}
