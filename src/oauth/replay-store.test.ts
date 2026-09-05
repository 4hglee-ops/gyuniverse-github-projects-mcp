import assert from "node:assert/strict";
import test from "node:test";

import {
  AtomicReplayRedisClient,
  MemoryOAuthReplayStore,
  RedisOAuthReplayStore,
} from "./replay-store.js";

test("memory replay store consumes a code only once", async () => {
  const store = new MemoryOAuthReplayStore();

  assert.equal(await store.consume("code-1", 9999999999), true);
  assert.equal(await store.consume("code-1", 9999999999), false);
});

test("expired entries are removed before consuming a new code", async () => {
  const store = new MemoryOAuthReplayStore();

  assert.equal(await store.consume("expired", 1), false);
  assert.equal(await store.consume("expired", 9999999999), true);
});

test("redis replay store atomically consumes a hashed code", async () => {
  const entries = new Set<string>();
  const calls: Array<{ key: string; value: string; exat: number }> = [];
  const redis: AtomicReplayRedisClient = {
    async set(key, value, options) {
      calls.push({ key, value, exat: options.exat });
      if (entries.has(key)) return null;
      entries.add(key);
      return "OK";
    },
  };
  const store = new RedisOAuthReplayStore(redis, "test:");
  const expiresAt = Math.floor(Date.now() / 1000) + 60;

  assert.equal(await store.consume("secret-code", expiresAt), true);
  assert.equal(await store.consume("secret-code", expiresAt), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].value, "1");
  assert.equal(calls[0].exat, expiresAt);
  assert.match(calls[0].key, /^test:[0-9a-f]{64}$/);
  assert.equal(calls[0].key.includes("secret-code"), false);
});

test("redis replay store rejects expired codes without writing", async () => {
  let writes = 0;
  const store = new RedisOAuthReplayStore({
    async set() {
      writes += 1;
      return "OK";
    },
  });

  assert.equal(await store.consume("expired", Math.floor(Date.now() / 1000)), false);
  assert.equal(writes, 0);
});

test("redis replay store fails closed when Redis is unavailable", async () => {
  const store = new RedisOAuthReplayStore({
    async set() {
      throw new Error("redis unavailable");
    },
  });

  await assert.rejects(
    store.consume("code", Math.floor(Date.now() / 1000) + 60),
    /redis unavailable/,
  );
});
