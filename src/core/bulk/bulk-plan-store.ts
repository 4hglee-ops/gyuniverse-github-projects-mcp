import type { BulkPlan, BulkPlanState } from "./bulk-plan.js";
import { assertBulkPlanValid } from "./bulk-plan.js";

export interface BulkPlanStoreLike {
  readonly persistence: { kind: "process_local" | "upstash"; survivesServerRestart: boolean };
  create(plan: BulkPlan): Promise<void>;
  get(planId: string): Promise<BulkPlan | null>;
  compareAndSet(planId: string, expectedState: BulkPlanState, next: BulkPlan): Promise<boolean>;
}

export class MemoryBulkPlanStore implements BulkPlanStoreLike {
  readonly persistence = { kind: "process_local" as const, survivesServerRestart: false };
  private readonly plans = new Map<string, BulkPlan>();

  async create(plan: BulkPlan): Promise<void> {
    assertBulkPlanValid(plan);
    if (this.plans.has(plan.planId)) throw new Error("BULK_PLAN_ID_COLLISION: Plan ID already exists.");
    this.plans.set(plan.planId, structuredClone(plan));
  }

  async get(planId: string): Promise<BulkPlan | null> {
    const plan = this.plans.get(planId);
    return plan ? structuredClone(plan) : null;
  }

  async compareAndSet(planId: string, expectedState: BulkPlanState, next: BulkPlan): Promise<boolean> {
    assertBulkPlanValid(next);
    if (next.planId !== planId) throw new Error("BULK_PLAN_ID_MISMATCH: State transition changed plan identity.");
    const current = this.plans.get(planId);
    if (!current || current.state !== expectedState || current.planDigest !== next.planDigest) return false;
    this.plans.set(planId, structuredClone(next));
    return true;
  }
}

export interface RedisBulkPlanClient {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { nx: true; ex: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
}

const CAS = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
local decoded = cjson.decode(current)
if decoded.state ~= ARGV[1] or decoded.planDigest ~= ARGV[2] then return 0 end
redis.call("SET", KEYS[1], ARGV[3], "EX", ARGV[4])
return 1
`;

export class RedisBulkPlanStore implements BulkPlanStoreLike {
  readonly persistence = { kind: "upstash" as const, survivesServerRestart: true };
  constructor(private readonly redis: RedisBulkPlanClient, private readonly keyPrefix = "gyuniverse:m10:bulk-plan:v1:") {}

  async create(plan: BulkPlan): Promise<void> {
    assertBulkPlanValid(plan);
    const created = await this.redis.set(this.key(plan.planId), JSON.stringify(plan), { nx: true, ex: this.retention(plan) });
    if (created !== "OK") throw new Error("BULK_PLAN_ID_COLLISION: Plan ID already exists.");
  }

  async get(planId: string): Promise<BulkPlan | null> {
    const raw = await this.redis.get(this.key(planId));
    if (raw === null || raw === undefined) return null;
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); } catch { throw new Error("DURABLE_BULK_PLAN_INVALID: Stored plan is not valid JSON."); }
    }
    assertBulkPlanValid(parsed);
    if (parsed.planId !== planId) throw new Error("DURABLE_BULK_PLAN_INVALID: Stored plan ID does not match its key.");
    return parsed;
  }

  async compareAndSet(planId: string, expectedState: BulkPlanState, next: BulkPlan): Promise<boolean> {
    assertBulkPlanValid(next);
    if (next.planId !== planId) throw new Error("BULK_PLAN_ID_MISMATCH: State transition changed plan identity.");
    const result = await this.redis.eval(CAS, [this.key(planId)], [expectedState, next.planDigest, JSON.stringify(next), this.retention(next)]);
    return result === 1 || result === "1";
  }

  private key(planId: string): string {
    if (!/^bulk-plan-[0-9a-f-]{36}$/.test(planId)) throw new Error("BULK_PLAN_ID_INVALID: Invalid plan ID.");
    return `${this.keyPrefix}${planId}`;
  }

  private retention(plan: BulkPlan): number {
    const terminalRetentionSeconds = 60 * 60 * 24 * 30;
    return Math.max(60, Math.ceil((Date.parse(plan.artifact.expiresAt) - Date.now()) / 1000) + terminalRetentionSeconds);
  }
}
