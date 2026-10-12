import {
  type McpServer,
  WebStandardStreamableHTTPServerTransport,
  isLegacyRequest,
} from "@modelcontextprotocol/server";

/**
 * Experimental opt-in mitigation for SDK v2.0.0 legacy-mode SSE.
 *
 * The SDK's createMcpHandler currently ignores responseMode=json when serving
 * 2025-era requests. This uses the SDK's own stateless transport with the
 * supported enableJsonResponse option rather than interpreting SSE frames.
 *
 * Only the legacy POST path is handled here. Modern traffic and the default
 * behavior of createMcpHandler remain unchanged until explicit rollout.
 */
export function legacyJsonTransportEnabled(): boolean {
  return process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED === "true";
}

export async function shouldUseLegacyJsonTransport(request: Request): Promise<boolean> {
  return legacyJsonTransportEnabled() &&
    request.method.toUpperCase() === "POST" &&
    await isLegacyRequest(request);
}

function internalError(): Response {
  return Response.json({
    jsonrpc: "2.0",
    error: { code: -32603, message: "Internal server error" },
    id: null,
  }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

/**
 * One server and one stateless transport per request.
 *
 * The transport buffers the terminal JSON-RPC response and produces a bounded
 * application/json body. No project mutation is retried or repeated here.
 * Abort tears down the server so client disconnects do not leave SSE running.
 */
export async function serveLegacyJsonTransport(
  request: Request,
  makeServer: () => McpServer,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  let product: McpServer | null = null;
  let closing: Promise<void> | null = null;

  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      await Promise.allSettled([
        transport.close(),
        product?.close(),
      ]);
    })();
    return closing;
  };

  let abortListener: (() => void) | null = null;
  const aborted = new Promise<Response>((resolve) => {
    abortListener = () => {
      void close();
      // The SDK may leave a buffered JSON response pending after close().
      // Return promptly without claiming the operation did not execute.
      resolve(new Response("Request cancelled; execution outcome unknown", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }));
    };
    request.signal.addEventListener("abort", abortListener, { once: true });
    if (request.signal.aborted) abortListener();
  });

  try {
    if (request.signal.aborted) {
      return new Response("Request cancelled", { status: 503 });
    }
    product = makeServer();
    await product.connect(transport);
    return await Promise.race([transport.handleRequest(request), aborted]);
  } catch {
    return internalError();
  } finally {
    if (abortListener) request.signal.removeEventListener("abort", abortListener);
    // Never block the response path on SDK close() during cancellation.
    // Cleanup is best-effort; a late response does not trigger another call.
    void close();
  }
}
