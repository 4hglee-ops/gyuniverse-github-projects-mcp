import { Redis } from "@upstash/redis";

function firstEnvironmentValue(...names: string[]): string | null {
  return names
    .map((name) => process.env[name]?.trim())
    .find((value): value is string => Boolean(value)) ?? null;
}

export function hasSharedUpstashCredentials(): boolean {
  return Boolean(
    firstEnvironmentValue(
      "UPSTASH_REDIS_REST_URL",
      "KV_REST_API_URL",
      "MCP_REPLAY_KV_REST_API_URL",
    ) &&
    firstEnvironmentValue(
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_TOKEN",
      "MCP_REPLAY_KV_REST_API_TOKEN",
    ),
  );
}

export function createSharedUpstashRedis(): Redis {
  const url = firstEnvironmentValue(
    "UPSTASH_REDIS_REST_URL",
    "KV_REST_API_URL",
    "MCP_REPLAY_KV_REST_API_URL",
  );
  const token = firstEnvironmentValue(
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_TOKEN",
    "MCP_REPLAY_KV_REST_API_TOKEN",
  );

  if (!url || !token) {
    throw new Error(
      "Upstash credentials are required for durable M10 governance storage.",
    );
  }

  return new Redis({ url, token });
}

export type GovernancePersistenceMode = "memory" | "upstash";

export function governancePersistenceMode(): GovernancePersistenceMode {
  const configured = process.env.M10_GOVERNANCE_STORE?.trim().toLowerCase();
  if (configured) {
    if (configured !== "memory" && configured !== "upstash") {
      throw new Error("M10_GOVERNANCE_STORE must be either memory or upstash.");
    }
    if (configured === "upstash" && !hasSharedUpstashCredentials()) {
      throw new Error(
        "M10_GOVERNANCE_STORE=upstash requires shared Upstash REST credentials.",
      );
    }
    return configured;
  }

  // Production already requires a durable OAuth replay store. Reuse the same
  // Upstash deployment with separate M10 key namespaces when those credentials
  // are present, while keeping local development dependency-free by default.
  if (
    process.env.MCP_OAUTH_REPLAY_STORE?.trim().toLowerCase() === "upstash" &&
    hasSharedUpstashCredentials()
  ) {
    return "upstash";
  }

  return "memory";
}
