import assert from "node:assert/strict";
import test from "node:test";

import vercelFetchHandler from "./vercel.js";

test("Vercel fetch adapter delegates to the remote HTTP router", async () => {
  const response = await vercelFetchHandler.fetch(
    new Request("https://projects.example.test/health"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "gyuniverse-github-projects-mcp",
  });
});
