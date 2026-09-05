import assert from "node:assert/strict";
import test from "node:test";

import { handleRemoteHttpRequest } from "./router.js";

async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const before = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    before.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("serves protected-resource and authorization-server discovery", async () => {
  await withEnv(
    {
      PUBLIC_BASE_URL: "https://projects.example.test",
      MCP_OAUTH_WRITE_ENABLED: undefined,
    },
    async () => {
      const resource = await handleRemoteHttpRequest(
        new Request("https://projects.example.test/.well-known/oauth-protected-resource"),
      );
      assert.equal(resource.status, 200);
      const resourceBody = await resource.json() as {
        resource: string;
        authorization_servers: string[];
        scopes_supported: string[];
      };
      assert.equal(resourceBody.resource, "https://projects.example.test/mcp");
      assert.deepEqual(resourceBody.authorization_servers, ["https://projects.example.test"]);
      assert.deepEqual(resourceBody.scopes_supported, ["projects:read"]);

      const authorization = await handleRemoteHttpRequest(
        new Request("https://projects.example.test/.well-known/oauth-authorization-server"),
      );
      assert.equal(authorization.status, 200);
      const authBody = await authorization.json() as {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        registration_endpoint: string;
      };
      assert.equal(authBody.issuer, "https://projects.example.test");
      assert.equal(authBody.authorization_endpoint, "https://projects.example.test/oauth/authorize");
      assert.equal(authBody.token_endpoint, "https://projects.example.test/oauth/token");
      assert.equal(authBody.registration_endpoint, "https://projects.example.test/oauth/register");
    },
  );
});

test("unauthenticated MCP requests receive an OAuth resource challenge before config or GitHub access", async () => {
  await withEnv(
    {
      PUBLIC_BASE_URL: "https://projects.example.test",
      GITHUB_TOKEN: undefined,
    },
    async () => {
      const response = await handleRemoteHttpRequest(
        new Request("https://projects.example.test/mcp", { method: "POST" }),
      );
      assert.equal(response.status, 401);
      assert.match(
        response.headers.get("www-authenticate") ?? "",
        /resource_metadata="https:\/\/projects\.example\.test\/\.well-known\/oauth-protected-resource"/,
      );
      assert.match(response.headers.get("www-authenticate") ?? "", /scope="projects:read"/);
    },
  );
});

test("unknown routes and unsupported methods fail closed", async () => {
  const missing = await handleRemoteHttpRequest(new Request("https://projects.example.test/nope"));
  assert.equal(missing.status, 404);

  const badMethod = await handleRemoteHttpRequest(new Request(
    "https://projects.example.test/.well-known/oauth-protected-resource",
    { method: "POST" },
  ));
  assert.equal(badMethod.status, 405);
});
