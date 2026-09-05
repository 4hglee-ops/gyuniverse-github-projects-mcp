import { createHash } from "node:crypto";

export interface OAuthReplayStore {
  /**
   * Atomically consumes a one-time authorization code.
   *
   * Implementations must guarantee that only one concurrent consumer can
   * successfully consume the same code.
   */
  consume(code: string, expiresAt: number): Promise<boolean>;
}

/**
 * Development fallback only.
 *
 * This keeps local stdio/testing workflows simple. Production deployments
 * using multiple instances must provide a shared implementation.
 */
export class MemoryOAuthReplayStore implements OAuthReplayStore {
  private readonly consumed = new Map<string, number>();

  async consume(code: string, expiresAt: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);

    for (const [storedCode, expiry] of this.consumed) {
      if (expiry <= now) this.consumed.delete(storedCode);
    }

    if (expiresAt <= now || this.consumed.has(code)) return false;

    this.consumed.set(code, expiresAt);
    return true;
  }
}

/**
 * Adapter contract for shared state providers.
 *
 * Examples:
 * - Redis / KV implementation
 * - database-backed implementation
 *
 * Production currently selects the Redis implementation through the store factory.
 */
export interface SharedOAuthReplayStore extends OAuthReplayStore {}

export interface AtomicReplayRedisClient {
  set(
    key: string,
    value: string,
    options: { nx: true; exat: number },
  ): Promise<string | null>;
}

/**
 * Shared replay protection for horizontally scaled and serverless runtimes.
 *
 * SET NX makes consumption atomic across instances. The raw authorization code
 * is never written to Redis; only its SHA-256 digest is used in the key.
 */
export class RedisOAuthReplayStore implements SharedOAuthReplayStore {
  constructor(
    private readonly redis: AtomicReplayRedisClient,
    private readonly keyPrefix = "mcp:oauth:authorization-code:",
  ) {}

  async consume(code: string, expiresAt: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt <= now) return false;

    const digest = createHash("sha256").update(code).digest("hex");
    const result = await this.redis.set(`${this.keyPrefix}${digest}`, "1", {
      nx: true,
      exat: expiresAt,
    });

    return result === "OK";
  }
}
