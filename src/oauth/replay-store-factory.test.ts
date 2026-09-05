import assert from "node:assert/strict";
import test from "node:test";

import {
  createOAuthReplayStore,
  oauthReplayStoreMode,
} from "./replay-store-factory.js";
import { MemoryOAuthReplayStore, RedisOAuthReplayStore } from "./replay-store.js";

const ENV_KEYS = [
  "MCP_OAUTH_REPLAY_STORE",
  "NODE_ENV",
  "VERCEL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

async function withEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  run: () => void | Promise<void>,
): Promise<void> {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("replay store defaults to memory only outside production", async () => {
  await withEnv({}, () => {
    assert.equal(oauthReplayStoreMode(), "memory");
    assert.ok(createOAuthReplayStore() instanceof MemoryOAuthReplayStore);
  });
});

test("production requires an explicit shared replay store", async () => {
  await withEnv({ VERCEL: "1" }, () => {
    assert.throws(() => oauthReplayStoreMode(), /explicitly configured/);
  });

  await withEnv(
    { NODE_ENV: "production", MCP_OAUTH_REPLAY_STORE: "memory" },
    () => assert.throws(() => oauthReplayStoreMode(), /not allowed in production/),
  );
});

test("upstash mode accepts Upstash and Vercel Marketplace credentials", async () => {
  await withEnv(
    {
      MCP_OAUTH_REPLAY_STORE: "upstash",
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
    },
    () => assert.ok(createOAuthReplayStore() instanceof RedisOAuthReplayStore),
  );

  await withEnv(
    {
      MCP_OAUTH_REPLAY_STORE: "upstash",
      KV_REST_API_URL: "https://example.upstash.io",
      KV_REST_API_TOKEN: "token",
    },
    () => assert.ok(createOAuthReplayStore() instanceof RedisOAuthReplayStore),
  );
});

test("upstash mode fails closed when credentials are missing", async () => {
  await withEnv({ MCP_OAUTH_REPLAY_STORE: "upstash" }, () => {
    assert.throws(() => createOAuthReplayStore(), /UPSTASH_REDIS_REST_URL/);
  });
});
