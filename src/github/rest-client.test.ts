import assert from "node:assert/strict";
import test from "node:test";

import { GitHubRestClient } from "./rest-client.js";

test("REST client uses the Projects API version without exposing the token", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const client = new GitHubRestClient("secret-token", {
    baseUrl: "https://example.test/",
    fetchImplementation: async (input, init) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const result = await client.request<{ ok: boolean }>("POST", "/projects", { name: "Backlog" });

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.url, "https://example.test/projects");
  assert.equal(new Headers(captured.init?.headers).get("X-GitHub-Api-Version"), "2026-03-10");
  assert.equal(captured.init?.body, JSON.stringify({ name: "Backlog" }));
});

test("REST errors are bounded and do not include request authorization", async () => {
  const client = new GitHubRestClient("do-not-leak", {
    fetchImplementation: async () => new Response("x".repeat(3_000), { status: 422 }),
  });

  await assert.rejects(
    () => client.request("POST", "/projects", {}),
    (error: Error) => {
      assert.match(error.message, /^GitHub REST request failed \(422\): /);
      assert.ok(error.message.length < 2_100);
      assert.doesNotMatch(error.message, /do-not-leak/);
      return true;
    },
  );
});
