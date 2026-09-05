import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { createNodeHttpServer } from "./node-server.js";

test("Node HTTP adapter serves router responses over a real socket", async () => {
  const previousBaseUrl = process.env.PUBLIC_BASE_URL;
  const server = createNodeHttpServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.PUBLIC_BASE_URL = baseUrl;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "gyuniverse-github-projects-mcp",
    });

    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.status, 200);
    assert.deepEqual((await metadata.json() as { authorization_servers: string[] }).authorization_servers, [
      baseUrl,
    ]);

    const mcp = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    assert.equal(mcp.status, 401);
    assert.match(mcp.headers.get("www-authenticate") ?? "", /scope="projects:read"/);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousBaseUrl;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
