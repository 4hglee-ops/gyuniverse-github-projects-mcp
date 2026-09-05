import {
  authorizationServerMetadata,
  authorizeOAuth,
  protectedResourceMetadata,
  registerOAuthClient,
  tokenOAuth,
} from "../oauth/endpoints.js";
import { handleRemoteMcpRequest } from "./remote-mcp.js";

function metadataResponse(value: Record<string, unknown>): Response {
  return Response.json(value, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}

export async function handleRemoteHttpRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/.well-known/oauth-protected-resource") {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    return metadataResponse(protectedResourceMetadata());
  }

  if (
    url.pathname === "/.well-known/oauth-authorization-server" ||
    url.pathname === "/.well-known/openid-configuration"
  ) {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    return metadataResponse(authorizationServerMetadata());
  }

  if (url.pathname === "/oauth/register") return registerOAuthClient(request);
  if (url.pathname === "/oauth/authorize") return authorizeOAuth(request);
  if (url.pathname === "/oauth/token") return tokenOAuth(request);

  if (url.pathname === "/mcp") {
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }
    return handleRemoteMcpRequest(request);
  }

  if (url.pathname === "/health" && request.method === "GET") {
    return Response.json({ ok: true, service: "gyuniverse-github-projects-mcp" });
  }

  return new Response("Not Found", { status: 404 });
}
