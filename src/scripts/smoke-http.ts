import assert from "node:assert/strict";

const port = process.env.MCP_HTTP_PORT ?? process.env.PORT ?? "3000";
const baseUrl = (process.env.MCP_HTTP_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");
const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? baseUrl).replace(/\/$/, "");

async function getJson<T>(path: string): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
  return { response, body: await response.json() as T };
}

const health = await getJson<{ ok: boolean; service: string }>("/health");
assert.equal(health.body.ok, true);
assert.equal(health.body.service, "gyuniverse-github-projects-mcp");

const resource = await getJson<{
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
}>("/.well-known/oauth-protected-resource");
assert.equal(resource.body.resource, `${publicBaseUrl}/mcp`);
assert.ok(resource.body.authorization_servers.length > 0);
assert.ok(resource.body.scopes_supported.includes("projects:read"));

const authorization = await getJson<{
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported: string[];
}>("/.well-known/oauth-authorization-server");
assert.equal(authorization.body.issuer, publicBaseUrl);
assert.equal(authorization.body.authorization_endpoint, `${publicBaseUrl}/oauth/authorize`);
assert.equal(authorization.body.token_endpoint, `${publicBaseUrl}/oauth/token`);
assert.equal(authorization.body.registration_endpoint, `${publicBaseUrl}/oauth/register`);
assert.ok(authorization.body.code_challenge_methods_supported.includes("S256"));

const mcp = await fetch(`${baseUrl}/mcp`, { method: "POST" });
assert.equal(mcp.status, 401, `/mcp returned HTTP ${mcp.status}, expected 401`);
const challenge = mcp.headers.get("www-authenticate") ?? "";
assert.match(challenge, /^Bearer /);
assert.match(challenge, /scope="projects:read"/);
assert.match(challenge, new RegExp(`resource_metadata="${publicBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/\.well-known\/oauth-protected-resource"`));

console.log(`HTTP smoke checks passed for ${baseUrl}`);
