import { validateViewPlan, type ViewPlan } from "./view-plan.js";

export interface ViewPlanStore {
  readonly persistence: "process-local" | "upstash";
  create(plan: ViewPlan): Promise<void>;
  get(planId: string): Promise<ViewPlan | null>;
  claim(plan: ViewPlan): Promise<boolean>;
  finish(plan: ViewPlan): Promise<void>;
}
export class MemoryViewPlanStore implements ViewPlanStore {
  readonly persistence = "process-local";
  private readonly plans = new Map<string, ViewPlan>();
  private readonly locks = new Map<string, string>();
  async create(plan: ViewPlan): Promise<void> {
    plan = validateViewPlan(plan);
    for (const [id, p] of this.plans) {
      if (p.state !== "applying" && !this.locks.has(p.artifact.projectId) && Date.parse(p.artifact.expiresAt) < Date.now()) this.plans.delete(id);
    }
    if (this.plans.size >= 1000 || this.plans.has(plan.planId)) throw new Error("VIEW_PLAN_STORE_FULL: Cannot save another plan.");
    this.plans.set(plan.planId, structuredClone(plan));
  }
  async get(id: string): Promise<ViewPlan | null> {
    const plan = this.plans.get(id);
    return plan ? validateViewPlan(structuredClone(plan)) : null;
  }
  async claim(plan: ViewPlan): Promise<boolean> {
    plan = validateViewPlan(plan);
    const current = this.plans.get(plan.planId);
    if (!current || current.state !== "previewed" || current.planDigest !== plan.planDigest || this.locks.has(plan.artifact.projectId)) return false;
    this.locks.set(plan.artifact.projectId, plan.planId);
    this.plans.set(plan.planId, { ...structuredClone(current), state: "applying" });
    return true;
  }
  async finish(plan: ViewPlan): Promise<void> {
    plan = validateViewPlan(plan);
    if (!["completed", "partial", "failed"].includes(plan.state) || this.locks.get(plan.artifact.projectId) !== plan.planId
      || this.plans.get(plan.planId)?.state !== "applying" || this.plans.get(plan.planId)?.planDigest !== plan.planDigest) {
      throw new Error("VIEW_PLAN_STATE_CONFLICT: Plan no longer owns this Project lock.");
    }
    this.plans.set(plan.planId, structuredClone(plan));
    if (!plan.results.some((r) => r.changed === null)) this.locks.delete(plan.artifact.projectId);
  }
}
export interface ViewRedis {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { nx: true; ex: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
}
const CLAIM = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
local p = cjson.decode(raw)
if p.state ~= 'previewed' or p.planDigest ~= ARGV[1] or p.artifact.projectId ~= ARGV[2] then return 0 end
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[2], p.planId)
redis.call('SET', KEYS[1], ARGV[3], 'KEEPTTL'); return 1
`;
const FINISH = `
local raw = redis.call('GET', KEYS[1]); if not raw then return 0 end
local p = cjson.decode(raw)
if p.state ~= 'applying' or p.planDigest ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= p.planId then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
if ARGV[3] == 'release' then redis.call('DEL', KEYS[2]) end; return 1
`;
export class RedisViewPlanStore implements ViewPlanStore {
  readonly persistence = "upstash";
  constructor(private readonly redis: ViewRedis) {}
  private async command<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch { throw new Error("VIEW_PLAN_STORE_UNAVAILABLE: Plan store request failed; inspect state before retrying."); }
  }
  private key(id: string): string {
    if (!/^view-plan-[0-9a-f-]{36}$/.test(id)) throw new Error("VIEW_PLAN_ID_INVALID: Invalid plan ID.");
    return "gyuniverse:views:v1:plan:" + id;
  }
  private lock(plan: ViewPlan): string { return "gyuniverse:views:v1:lock:" + plan.artifact.projectId; }
  async create(plan: ViewPlan): Promise<void> {
    plan = validateViewPlan(plan);
    const ex = Math.max(60, Math.ceil((Date.parse(plan.artifact.expiresAt) - Date.now()) / 1000)) + 30 * 86_400;
    if (await this.command(() => this.redis.set(this.key(plan.planId), JSON.stringify(plan), { nx: true, ex })) !== "OK") throw new Error("VIEW_PLAN_ID_COLLISION: Plan ID already exists.");
  }
  async get(id: string): Promise<ViewPlan | null> {
    const key = this.key(id);
    const raw = await this.command(() => this.redis.get(key));
    if (raw === null || raw === undefined) return null;
    let value = raw;
    try { if (typeof raw === "string") value = JSON.parse(raw); } catch { throw new Error("VIEW_PLAN_INVALID: Stored plan is not JSON."); }
    const plan = validateViewPlan(value);
    if (plan.planId !== id) throw new Error("VIEW_PLAN_INVALID: Stored plan identity changed.");
    return plan;
  }
  async claim(plan: ViewPlan): Promise<boolean> {
    plan = validateViewPlan(plan);
    // No expiring lease: a timed-out worker may still be mutating GitHub. Unknown ownership fails closed.
    return Number(await this.command(() => this.redis.eval(CLAIM, [this.key(plan.planId), this.lock(plan)], [plan.planDigest, plan.artifact.projectId, JSON.stringify({ ...plan, state: "applying" })]))) === 1;
  }
  async finish(plan: ViewPlan): Promise<void> {
    plan = validateViewPlan(plan);
    if (!["completed", "partial", "failed"].includes(plan.state)) throw new Error("VIEW_PLAN_STATE_CONFLICT: Expected terminal plan.");
    if (Number(await this.command(() => this.redis.eval(FINISH, [this.key(plan.planId), this.lock(plan)], [plan.planDigest, JSON.stringify(plan), plan.results.some((r) => r.changed === null) ? "retain" : "release"]))) !== 1) {
      throw new Error("VIEW_PLAN_STATE_CONFLICT: Plan finalization was not confirmed.");
    }
  }
}
