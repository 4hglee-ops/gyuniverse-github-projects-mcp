import { createSharedUpstashRedis, governancePersistenceMode } from "../persistence/upstash.js";
import {
  MemoryProjectCheckpointStore,
  RedisProjectCheckpointStore,
  type ProjectCheckpointStoreLike,
} from "./checkpoint-store.js";

export function createProjectCheckpointStore(): ProjectCheckpointStoreLike {
  if (governancePersistenceMode() === "memory") {
    return new MemoryProjectCheckpointStore();
  }

  const redis = createSharedUpstashRedis();
  return new RedisProjectCheckpointStore({
    get: (key) => redis.get(key),
    set: (key, value) => redis.set(key, value),
  });
}
