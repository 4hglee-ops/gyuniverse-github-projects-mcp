import { randomUUID } from "node:crypto";

/**
 * Opt-in, secret-free MCP HTTP timing telemetry.
 *
 * Only log enumerated stages and fixed metadata, never the URL, body, token,
 * OAuth subject, project data, JSON-RPC parameters or upstream error text.
 * Disabled by default (including Production).
 */
export type McpDiagnosticStage =
  | "oauth_verified"
  | "principal_resolved"
  | "acl_resolved"
  | "sdk_dispatch";

type DiagnosticEvent =
  | "started"
  | "stage"
  | "response_ready"
  | "sse_first_chunk"
  | "sse_complete"
  | "sse_cancelled"
  | "sse_error"
  | "request_aborted"
  | "slow_request"
  | "handler_error";

export interface McpDiagnosticLog {
  event: DiagnosticEvent;
  requestId: string;
  method: "GET" | "POST" | "DELETE" | "OTHER";
  stage: "started" | McpDiagnosticStage | "response_ready" | "sse_first_chunk";
  elapsedMs: number;
  status?: number;
  responseKind?: "sse" | "json" | "other";
  chunkCount?: number;
}

export interface McpDiagnosticsOptions {
  enabled?: boolean;
  logger?: (event: McpDiagnosticLog) => void;
  slowThresholdMs?: number;
}

function methodOf(method: string): McpDiagnosticLog["method"] {
  return method === "GET" || method === "POST" || method === "DELETE" ? method : "OTHER";
}

function responseKindOf(response: Response): "sse" | "json" | "other" {
  const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type === "text/event-stream") return "sse";
  if (type === "application/json") return "json";
  return "other";
}

/**
 * The handler itself is unchanged. Instrument response-body lifecycle only for
 * SSE: this preserves JSON/401 responses and avoids reading or buffering data.
 */
export async function traceMcpRequest(
  request: Request,
  handler: (stage: (stage: McpDiagnosticStage) => void) => Promise<Response>,
  options: McpDiagnosticsOptions = {},
): Promise<Response> {
  if (!(options.enabled ?? process.env.MCP_HTTP_DIAGNOSTICS_ENABLED === "true")) {
    return handler(() => {});
  }

  const requestId = randomUUID();
  const method = methodOf(request.method);
  const startedAt = Date.now();
  const logger = options.logger ?? ((event: McpDiagnosticLog) => console.info("mcp_http_diagnostic", event));
  let currentStage: McpDiagnosticLog["stage"] = "started";
  let status: number | undefined;
  let responseKind: McpDiagnosticLog["responseKind"];
  let chunkCount = 0;
  let finished = false;

  // Logging must not cause an otherwise valid request to fail.
  const report = (event: DiagnosticEvent) => {
    try {
      logger({
        event,
        requestId,
        method,
        stage: currentStage,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        ...(status === undefined ? {} : { status }),
        ...(responseKind === undefined ? {} : { responseKind }),
        ...(chunkCount ? { chunkCount } : {}),
      });
    } catch {
      // Diagnostic backend failures are never part of the MCP protocol.
    }
  };

  const mark = (stage: McpDiagnosticStage) => {
    currentStage = stage;
    report("stage");
  };

  const finish = (event: DiagnosticEvent) => {
    if (finished) return;
    finished = true;
    clearTimeout(slowTimer);
    request.signal.removeEventListener("abort", onAbort);
    report(event);
  };

  const onAbort = () => finish("request_aborted");
  request.signal.addEventListener("abort", onAbort, { once: true });
  const threshold = Math.max(1, options.slowThresholdMs ?? 20_000);
  const slowTimer = setTimeout(() => {
    if (!finished) report("slow_request");
  }, threshold);
  slowTimer.unref?.();
  report("started");

  try {
    const response = await handler(mark);
    status = response.status;
    responseKind = responseKindOf(response);
    currentStage = "response_ready";
    report("response_ready");

    if (responseKind !== "sse" || response.body === null) {
      finish("sse_complete");
      return response;
    }

    const reader = response.body.getReader();
    let firstChunk = true;
    const observedStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            finish("sse_complete");
            controller.close();
            return;
          }
          chunkCount++;
          if (firstChunk) {
            firstChunk = false;
            currentStage = "sse_first_chunk";
            report("sse_first_chunk");
          }
          controller.enqueue(chunk.value);
        } catch (error) {
          finish("sse_error");
          controller.error(error);
        }
      },
      async cancel(reason) {
        finish("sse_cancelled");
        await reader.cancel(reason);
      },
    });
    return new Response(observedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    finish("handler_error");
    throw error;
  }
}
