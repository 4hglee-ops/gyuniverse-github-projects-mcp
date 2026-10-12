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

  const onAbort = () => { void close(); };
  request.signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (request.signal.aborted) return new Response(null, { status: 503 });
    product = makeServer();
    await product.connect(transport);

    const response = await transport.handleRequest(request);
    // JSON and 202 acknowledgements contain no streaming response body;
    // the per-request server can be safely released after the reply settles.
    return response;
  } catch {
    // Never log or return raw SDK errors, request bodies, or credentials.
    return internalError();
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    await close();
  }
}
