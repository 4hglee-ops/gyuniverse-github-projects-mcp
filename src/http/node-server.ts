import "dotenv/config";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";

import { handleRemoteHttpRequest } from "./router.js";

export type RemoteHttpHandler = (request: Request) => Promise<Response>;

function requestUrl(request: IncomingMessage): URL {
  const host = request.headers.host ?? "localhost";
  return new URL(request.url ?? "/", `http://${host}`);
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    headers.append(request.rawHeaders[index], request.rawHeaders[index + 1]);
  }
  return headers;
}

function fetchRequest(request: IncomingMessage, signal: AbortSignal): Request {
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method ?? "GET",
    headers: requestHeaders(request),
    signal,
  };

  if (init.method !== "GET" && init.method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }

  return new Request(requestUrl(request), init);
}

async function writeResponse(response: Response, outgoing: ServerResponse): Promise<void> {
  outgoing.statusCode = response.status;
  if (response.statusText) outgoing.statusMessage = response.statusText;

  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") outgoing.setHeader(name, value);
  });

  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);

  if (!response.body) {
    outgoing.end();
    return;
  }

  for await (const chunk of response.body) {
    if (!outgoing.write(chunk)) await once(outgoing, "drain");
  }
  outgoing.end();
}

export function createNodeHttpServer(handler: RemoteHttpHandler = handleRemoteHttpRequest) {
  const server = createServer((incoming, outgoing) => {
    const abortController = new AbortController();
    incoming.once("aborted", () => abortController.abort());
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) abortController.abort();
    });

    void handler(fetchRequest(incoming, abortController.signal))
      .then((response) => writeResponse(response, outgoing))
      .catch((error: unknown) => {
        console.error("remote MCP HTTP request failed", error);
        if (outgoing.headersSent) {
          outgoing.destroy(error instanceof Error ? error : undefined);
          return;
        }
        outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        outgoing.end("Internal Server Error");
      });
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return server;
}

function configuredPort(): number {
  const raw = process.env.MCP_HTTP_PORT ?? process.env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid MCP_HTTP_PORT/PORT: ${raw}`);
  }
  return port;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url);
}

if (isMainModule()) {
  const host = process.env.MCP_HTTP_HOST?.trim() || "0.0.0.0";
  const port = configuredPort();
  const server = createNodeHttpServer();

  server.listen(port, host, () => {
    console.error(`remote MCP HTTP server listening on http://${host}:${port}`);
  });

  const shutdown = (signal: string) => {
    console.error(`${signal} received; closing remote MCP HTTP server`);
    server.close((error) => {
      if (error) {
        console.error("remote MCP HTTP server shutdown failed", error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
