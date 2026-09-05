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

    if (this.consumed.has(code)) return false;

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
 * This repository intentionally does not select a provider here.
 */
export interface SharedOAuthReplayStore extends OAuthReplayStore {}
