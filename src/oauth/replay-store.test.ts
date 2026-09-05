import assert from "node:assert/strict";
import test from "node:test";

import { MemoryOAuthReplayStore } from "./replay-store.js";

test("memory replay store consumes a code only once", async () => {
  const store = new MemoryOAuthReplayStore();

  assert.equal(await store.consume("code-1", 9999999999), true);
  assert.equal(await store.consume("code-1", 9999999999), false);
});

test("expired entries are removed before consuming a new code", async () => {
  const store = new MemoryOAuthReplayStore();

  assert.equal(await store.consume("expired", 1), true);
  assert.equal(await store.consume("expired", 9999999999), true);
});
