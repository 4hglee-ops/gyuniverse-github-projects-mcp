import { createSharedUpstashRedis, governancePersistenceMode } from "../persistence/upstash.js";
import { MemoryBulkPlanStore, RedisBulkPlanStore, type BulkPlanStoreLike } from "./bulk-plan-store.js";

export function createBulkPlanStore(): BulkPlanStoreLike {
  if (governancePersistenceMode() === "memory") return new MemoryBulkPlanStore();
  const redis = createSharedUpstashRedis();
  return new RedisBulkPlanStore({
    get: (key) => redis.get(key),
    set: (key, value, options) => redis.set(key, value, options),
    eval: (script, keys, args) => redis.eval(script, keys, args),
  });
}
