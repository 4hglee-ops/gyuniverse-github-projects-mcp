import type { AuthenticatedPrincipal } from "../identity/principal.js";
import { projectIdOf } from "../projects/project-service.js";
import type { WriteOperation, WritePolicy } from "../policy/write-policy.js";
import { isAuditPersistenceFailure, type AuditService } from "../audit/audit-service.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import {
  inspectProjectSingleSelectByName,
  updateProjectSingleSelectByName,
  type NamedSingleSelectPreview,
  type NamedSingleSelectUpdateInput,
  type NamedSingleSelectUpdateResult,
} from "../../workflow/single-select-update.js";
import { bulkErrorCode, createBulkPlan, type BulkField, type BulkPlan, type BulkPlanArtifact, type BulkPlanOperation } from "./bulk-plan.js";
import type { BulkPlanStoreLike } from "./bulk-plan-store.js";
import { BulkApprovalPolicy } from "../policy/bulk-approval-policy.js";
import type { BulkApprovalMode } from "../../config.js";

export interface BulkUpdateRequest { itemId: string; field: BulkField; value: string }
export interface BulkPlanProjectReader { resolveProject(owner: string, number: number): Promise<unknown> }

interface BulkPlanServiceOptions {
  client: GitHubGraphQlClient;
  projects: BulkPlanProjectReader;
  principal: AuthenticatedPrincipal | null;
  writePolicy: WritePolicy;
  audit: AuditService;
  store: BulkPlanStoreLike;
  now?: () => Date;
  ttlMs?: number;
  inspect?: (client: GitHubGraphQlClient, input: NamedSingleSelectUpdateInput) => Promise<NamedSingleSelectPreview>;
  update?: (client: GitHubGraphQlClient, input: NamedSingleSelectUpdateInput) => Promise<NamedSingleSelectUpdateResult>;
  bulkApprovalMode?: BulkApprovalMode;
}

const operationFor = (field: BulkField): WriteOperation => field === "Status" ? "update_status" : "update_priority";

export class BulkPlanService {
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly inspect: NonNullable<BulkPlanServiceOptions["inspect"]>;
  private readonly update: NonNullable<BulkPlanServiceOptions["update"]>;
  private readonly approvalPolicy: BulkApprovalPolicy;

  constructor(private readonly options: BulkPlanServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000;
    this.inspect = options.inspect ?? inspectProjectSingleSelectByName;
    this.update = options.update ?? updateProjectSingleSelectByName;
    this.approvalPolicy = new BulkApprovalPolicy(options.bulkApprovalMode);
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 60_000 || this.ttlMs > 60 * 60 * 1000) {
      throw new Error("BULK_PLAN_TTL_INVALID: TTL must be between one minute and one hour.");
    }
  }

  async preview(owner: string, number: number, requests: BulkUpdateRequest[]): Promise<BulkPlan> {
    const actor = this.assertAuthenticated();
    if (requests.length < 1 || requests.length > 20) throw new Error("BULK_PLAN_SIZE_INVALID: Provide between 1 and 20 operations.");
    const keys = requests.map((item) => `${item.itemId}\0${item.field}`);
    if (new Set(keys).size !== keys.length) throw new Error("BULK_PLAN_DUPLICATE_TARGET: Each item/field pair may appear only once.");
    const project = await this.options.projects.resolveProject(owner, number);
    const projectId = projectIdOf(project);
    this.options.writePolicy.authorize({ operation: "preview_bulk_plan", projectId });
    for (const request of requests) this.options.writePolicy.authorize({ operation: operationFor(request.field), projectId });

    const operations: BulkPlanOperation[] = [];
    for (const [index, request] of requests.entries()) {
      const preview = await this.inspect(this.options.client, {
        owner, projectNumber: number, projectId, itemId: request.itemId,
        fieldName: request.field, optionName: request.value,
      });
      if (preview.itemId !== request.itemId) throw new Error("PROJECT_ITEM_INVALID: Resolved item identity changed.");
      operations.push({
        index, itemId: request.itemId, field: request.field, fieldId: preview.field.id,
        before: { optionId: preview.current?.id ?? null, name: preview.current?.name ?? null },
        after: { optionId: preview.requestedOption.id, name: preview.requestedOption.name },
      });
    }
    const createdAt = this.now();
    const artifact: BulkPlanArtifact = {
      version: 1, projectId, projectOwner: owner, projectNumber: number, createdBy: actor.id,
      createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + this.ttlMs).toISOString(), operations,
    };
    const plan = createBulkPlan(artifact);
    await this.options.store.create(plan);
    return plan;
  }

  async get(planId: string): Promise<BulkPlan> {
    const actor = this.assertAuthenticated();
    const plan = await this.required(planId);
    await this.assertProjectRead(plan);
    this.assertBulkParticipant(actor);
    return this.expireIfNeeded(plan, actor.id);
  }

  async approve(planId: string, planDigest: string): Promise<BulkPlan> {
    const actor = this.assertAuthenticated();
    let plan = await this.required(planId);
    this.assertDigest(plan, planDigest);
    plan = await this.expireIfNeeded(plan, actor.id);
    await this.reauthorizePlanAction(plan, "approve_bulk_plan");
    this.approvalPolicy.assertApprover(plan.artifact.createdBy, actor.id);
    if (plan.state === "approved" && plan.approvedBy === actor.id) return plan;
    if (plan.state !== "previewed") throw new Error(`BULK_PLAN_NOT_APPROVABLE: Plan state is '${plan.state}'.`);

    const at = this.now().toISOString();
    const next: BulkPlan = {
      ...plan, state: "approved", approvedBy: actor.id, approvedAt: at,
      events: [...plan.events, { type: "approved", actorId: actor.id, at }],
    };
    if (!(await this.options.store.compareAndSet(planId, "previewed", next))) {
      const current = await this.required(planId);
      if (current.state === "approved" && current.approvedBy === actor.id && current.planDigest === planDigest) return current;
      throw new Error("BULK_PLAN_STATE_CONFLICT: Approval raced with another state transition.");
    }
    return next;
  }

  async apply(planId: string, planDigest: string): Promise<BulkPlan> {
    const actor = this.assertAuthenticated();
    let plan = await this.required(planId);
    this.assertDigest(plan, planDigest);
    plan = await this.expireIfNeeded(plan, actor.id);
    await this.reauthorizePlanAction(plan, "apply_bulk_plan", true);
    if (["completed", "partial", "failed", "expired"].includes(plan.state)) return plan;
    if (plan.state === "applying") throw new Error("BULK_PLAN_APPLY_IN_PROGRESS: This plan is already being applied.");
    if (plan.state !== "approved" || !plan.approvedBy) {
      throw new Error("BULK_PLAN_APPROVAL_REQUIRED: An authorized admin must explicitly approve this plan first.");
    }
    this.approvalPolicy.assertApprover(plan.artifact.createdBy, plan.approvedBy);

    try {
      await this.preflight(plan, false);
    } catch (error) {
      return this.failBeforeMutation(plan, actor.id, bulkErrorCode(error) === "UNEXPECTED_WRITE_ERROR" ? "PLAN_PREFLIGHT_FAILED" : bulkErrorCode(error));
    }

    const startedAt = this.now().toISOString();
    const applying: BulkPlan = {
      ...plan, state: "applying", applyStartedAt: startedAt,
      events: [...plan.events, { type: "apply_started", actorId: actor.id, at: startedAt }],
    };
    if (!(await this.options.store.compareAndSet(planId, "approved", applying))) {
      const current = await this.required(planId);
      if (["completed", "partial", "failed", "expired"].includes(current.state)) return current;
      throw new Error("BULK_PLAN_STATE_CONFLICT: Apply was not claimed; no mutation was started by this call.");
    }

    const results = [] as BulkPlan["results"];
    for (const operation of applying.artifact.operations) {
      const writeOperation = operationFor(operation.field);
      let completedWrite: NamedSingleSelectUpdateResult | null = null;
      try {
        const result = completedWrite = await this.update(this.options.client, {
          owner: applying.artifact.projectOwner, projectNumber: applying.artifact.projectNumber,
          projectId: applying.artifact.projectId, itemId: operation.itemId,
          fieldName: operation.field, optionName: operation.after.name,
          expectedFieldId: operation.fieldId,
          expectedCurrentOptionId: operation.before.optionId,
          expectedTargetOptionId: operation.after.optionId,
        });
        const outcome = result.changed ? "success" : "no_change";
        const audit = await this.options.audit.record({
          operation: writeOperation, outcome, actorId: actor.id,
          projectId: applying.artifact.projectId, projectOwner: applying.artifact.projectOwner,
          projectNumber: applying.artifact.projectNumber, itemId: operation.itemId,
          fieldName: operation.field, requestedValue: operation.after.name,
          beforeValue: result.before?.name ?? null, afterValue: result.after?.name ?? null,
          verified: result.verified, errorCode: null, planId: applying.planId,
        });
        results.push({ index: operation.index, itemId: operation.itemId, field: operation.field,
          outcome, changed: result.changed, verified: result.verified, auditId: audit.id, errorCode: null });
      } catch (error) {
        let auditId: string | null = null;
        const errorCode = bulkErrorCode(error);
        if (!isAuditPersistenceFailure(error)) {
          try {
            const audit = await this.options.audit.recordFailure({
              operation: writeOperation, actorId: actor.id,
              projectId: applying.artifact.projectId, projectOwner: applying.artifact.projectOwner,
              projectNumber: applying.artifact.projectNumber, itemId: operation.itemId,
              fieldName: operation.field, requestedValue: operation.after.name,
              beforeValue: operation.before.name, afterValue: completedWrite?.after?.name ?? null, planId: applying.planId,
            }, error);
            auditId = audit.id;
          } catch { /* The terminal plan records the audit-persistence failure below. */ }
        }
        results.push({ index: operation.index, itemId: operation.itemId, field: operation.field,
          outcome: "failed", changed: completedWrite?.changed ?? false, verified: completedWrite?.verified ?? false, auditId,
          errorCode: auditId ? errorCode : "AUDIT_PERSISTENCE_FAILED" });
        break;
      }
    }

    const failed = results.find((result) => result.outcome === "failed");
    const state = failed ? (results.length > 1 ? "partial" : "failed") : "completed";
    const completedAt = this.now().toISOString();
    const terminal: BulkPlan = {
      ...applying, state, completedAt, results,
      events: [...applying.events, {
        type: state === "completed" ? "apply_completed" : state === "partial" ? "apply_partial" : "apply_failed",
        actorId: actor.id, at: completedAt, ...(failed?.errorCode ? { errorCode: failed.errorCode } : {}),
      }],
    };
    if (!(await this.options.store.compareAndSet(planId, "applying", terminal))) {
      throw new Error("BULK_PLAN_PERSISTENCE_FAILED: Terminal apply result could not be persisted; do not retry automatically.");
    }
    return terminal;
  }

  private assertAuthenticated(): AuthenticatedPrincipal {
    const principal = this.options.principal;
    if (!principal) throw new Error("IDENTITY_REQUIRED: M10 bulk plans require an authenticated principal.");
    return principal;
  }

  private assertBulkParticipant(principal: AuthenticatedPrincipal): void {
    if (!principal.permissions.some((permission) =>
      permission === "bulk.preview" || permission === "bulk.approve" || permission === "bulk.apply")) {
      throw new Error("CAPABILITY_REQUIRED: Reading a bulk plan requires a bulk workflow capability.");
    }
  }

  private assertDigest(plan: BulkPlan, digest: string): void {
    if (plan.planDigest !== digest) throw new Error("BULK_PLAN_DIGEST_MISMATCH: Approval/apply digest does not match the immutable preview.");
  }

  private async required(planId: string): Promise<BulkPlan> {
    const plan = await this.options.store.get(planId);
    if (!plan) throw new Error("BULK_PLAN_NOT_FOUND: Plan was not found.");
    return plan;
  }

  private async assertProjectRead(plan: BulkPlan): Promise<void> {
    const project = await this.options.projects.resolveProject(plan.artifact.projectOwner, plan.artifact.projectNumber);
    if (projectIdOf(project) !== plan.artifact.projectId) throw new Error("BULK_PLAN_PROJECT_CHANGED: Project identity changed.");
  }

  private async reauthorizePlanAction(
    plan: BulkPlan,
    operation: "approve_bulk_plan" | "apply_bulk_plan",
    includeItemWrites = false,
  ): Promise<void> {
    await this.assertProjectRead(plan);
    this.options.writePolicy.authorize({ operation, projectId: plan.artifact.projectId });
    if (includeItemWrites) {
      for (const item of plan.artifact.operations) {
        this.options.writePolicy.authorize({ operation: operationFor(item.field), projectId: plan.artifact.projectId });
      }
    }
  }

  private async preflight(plan: BulkPlan, reauthorize = true): Promise<void> {
    if (reauthorize) await this.reauthorizePlanAction(plan, "apply_bulk_plan", true);
    const previews: NamedSingleSelectPreview[] = [];
    for (const operation of plan.artifact.operations) {
      previews.push(await this.inspect(this.options.client, {
        owner: plan.artifact.projectOwner, projectNumber: plan.artifact.projectNumber,
        projectId: plan.artifact.projectId, itemId: operation.itemId,
        fieldName: operation.field, optionName: operation.after.name,
      }));
    }
    for (const [index, current] of previews.entries()) {
      const expected = plan.artifact.operations[index]!;
      if ((current.current?.id ?? null) !== expected.before.optionId ||
          (current.current?.name ?? null) !== expected.before.name ||
          current.itemId !== expected.itemId || current.field.id !== expected.fieldId ||
          current.requestedOption.id !== expected.after.optionId ||
          current.requestedOption.name !== expected.after.name) {
        throw new Error(`PLAN_STALE: Operation ${index} no longer matches its preview.`);
      }
    }
  }

  private async expireIfNeeded(plan: BulkPlan, actorId: string): Promise<BulkPlan> {
    if (!["previewed", "approved"].includes(plan.state) || Date.parse(plan.artifact.expiresAt) > this.now().getTime()) return plan;
    const at = this.now().toISOString();
    const expired: BulkPlan = { ...plan, state: "expired", completedAt: at,
      events: [...plan.events, { type: "expired", actorId, at }] };
    return await this.options.store.compareAndSet(plan.planId, plan.state, expired) ? expired : this.required(plan.planId);
  }

  private async failBeforeMutation(plan: BulkPlan, actorId: string, errorCode: string): Promise<BulkPlan> {
    const at = this.now().toISOString();
    const failed: BulkPlan = { ...plan, state: "failed", completedAt: at, results: [],
      events: [...plan.events, { type: "apply_failed", actorId, at, errorCode }] };
    if (!(await this.options.store.compareAndSet(plan.planId, "approved", failed))) {
      throw new Error("BULK_PLAN_STATE_CONFLICT: Preflight failure could not be recorded; no mutation was started.");
    }
    return failed;
  }
}
