import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { nowSeconds, signEnvelope, type AccessTokenPayload } from "../oauth/stateless.js";
import { handleRemoteMcpRequest } from "./remote-mcp.js";

const origin = "https://transport-test.example.invalid";
const config: AppConfig = {
  githubToken: "unused-test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_INTEGRATION_TEST"],
  writeEnabled: false,
};

class NoGitHubCalls extends GitHubGraphQlClient {
  constructor() { super("unused-test-token"); }
  override async request<T>(): Promise<T> {
    throw new Error("GitHub was not expected for identity/initialize.");
  }
}

async function within<T>(promise: Promise<T>, milliseconds: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error("MCP_AUTHENTICATED_TRANSPORT_TIMEOUT"));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readFirstChunk(response: Response, abort: () => void): Promise<string> {
  const reader = response.body?.getReader();
  assert.ok(reader, "MCP response body required");
  try {
    const chunk = await within(reader.read(), 6_000, abort);
    assert.equal(chunk.done, false, "MCP response should contain data");
    assert.ok(chunk.value && chunk.value.length > 0);
    return new TextDecoder().decode(chunk.value);
  } finally {
    // An event-stream may remain open by design; only require a timely
    // first result and deliberately close this simulated client connection.
    abort();
    void reader.cancel().catch(() => {});
  }
}

test("authenticated Remote MCP initializes and returns a bounded response", { timeout: 15_000 }, async () => {
  const previous = new Map<string, string | undefined>();
  const vars: Record<string, string> = {
    PUBLIC_BASE_URL: origin,
    MCP_OAUTH_SIGNING_SECRET: "transport-test-signing-secret-only",
    MCP_OAUTH_IDENTITIES_JSON: JSON.stringify([{
      subject: "user:transport-test",
      accessCode: "transport-test-code-only",
      role: "viewer",
      projectIds: ["PVT_INTEGRATION_TEST"],
      githubLogin: "transport-test",
    }]),
    M12_TEAM_ACL_MODE: "legacy",
    MCP_HTTP_DIAGNOSTICS_ENABLED: "false",
  };
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    const now = nowSeconds();
    const token = await signEnvelope("gypa", {
      typ: "access_token",
      aud: origin + "/mcp",
      scope: "projects:read",
      sub: "user:transport-test",
      iat: now,
      exp: now + 120,
    } satisfies AccessTokenPayload);

    const controller = new AbortController();
    const request = new Request(origin + "/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "transport-ci-smoke", version: "1.0.0" },
        },
      }),
    });
    const startedAt = Date.now();
    const response = await within(
      handleRemoteMcpRequest(request, { config, client: new NoGitHubCalls() }),
      8_000,
      () => controller.abort(),
    );
    assert.equal(response.status, 200, "initialize should return HTTP 200, got " + response.status);
    const firstChunk = await readFirstChunk(response, () => controller.abort());
    assert.match(firstChunk, /jsonrpc|result|protocolVersion|data:/);
    assert.ok(Date.now() - startedAt < 14_000, "authenticated MCP response must not hang");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
