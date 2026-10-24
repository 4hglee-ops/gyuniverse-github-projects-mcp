import { createSharedUpstashRedis, governancePersistenceMode } from "../persistence/upstash.js";
import { MemoryViewPlanStore, RedisViewPlanStore, type ViewPlanStore } from "./view-plan-store.js";

const memory = new MemoryViewPlanStore();
export function createViewPlanStore(): ViewPlanStore {
  if (governancePersistenceMode() === "memory") {
    if (["production", "preview"].includes(process.env.VERCEL_ENV ?? "") || process.env.NODE_ENV === "production") {
      throw new Error("VIEW_PLAN_DURABILITY_REQUIRED: Deployed View plans require shared Upstash storage.");
    }
    return memory;
  }
  return new RedisViewPlanStore(createSharedUpstashRedis());
}
