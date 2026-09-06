import { createSharedUpstashRedis, governancePersistenceMode } from "../persistence/upstash.js";
import {
  MemoryWriteAuditStore,
  RedisWriteAuditStore,
  type WriteAuditStoreLike,
} from "./audit-store.js";

export function createWriteAuditStore(maxEntries = 200): WriteAuditStoreLike {
  if (governancePersistenceMode() === "memory") {
    return new MemoryWriteAuditStore(maxEntries);
  }

  const redis = createSharedUpstashRedis();
  return new RedisWriteAuditStore({
    eval: (script, keys, args) => redis.eval(script, keys, args),
    lrange: (key, start, stop) => redis.lrange(key, start, stop),
  }, maxEntries);
}
