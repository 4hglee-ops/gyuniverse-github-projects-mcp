import { Redis } from "@upstash/redis";

import {
  MemoryOAuthReplayStore,
  OAuthReplayStore,
  RedisOAuthReplayStore,
} from "./replay-store.js";

export type OAuthReplayStoreMode = "memory" | "upstash";

function required(name: string, fallbackName?: string): string {
  const value = process.env[name]?.trim() ||
    (fallbackName ? process.env[fallbackName]?.trim() : undefined);

  if (!value) {
    const suffix = fallbackName ? ` (or ${fallbackName})` : "";
    throw new Error(`${name}${suffix} is required for the Upstash OAuth replay store`);
  }

  return value;
}

export function oauthReplayStoreMode(): OAuthReplayStoreMode {
  const configured = process.env.MCP_OAUTH_REPLAY_STORE?.trim().toLowerCase();

  if (!configured) {
    if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
      throw new Error(
        "MCP_OAUTH_REPLAY_STORE must be explicitly configured in production",
      );
    }
    return "memory";
  }

  if (configured !== "memory" && configured !== "upstash") {
    throw new Error("MCP_OAUTH_REPLAY_STORE must be either memory or upstash");
  }

  if (
    configured === "memory" &&
    (process.env.VERCEL === "1" || process.env.NODE_ENV === "production")
  ) {
    throw new Error("The memory OAuth replay store is not allowed in production");
  }

  return configured;
}

export function createOAuthReplayStore(): OAuthReplayStore {
  if (oauthReplayStoreMode() === "memory") return new MemoryOAuthReplayStore();

  const redis = new Redis({
    url: required("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"),
    token: required("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"),
  });

  return new RedisOAuthReplayStore({
    set: (key, value, options) => redis.set(key, value, options),
  });
}
