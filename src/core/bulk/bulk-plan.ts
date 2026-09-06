import { createHash, randomUUID } from "node:crypto";

export type BulkField = "Status" | "Priority";
export type BulkPlanState = "previewed" | "approved" | "applying" | "completed" | "partial" | "failed" | "expired";
export type BulkPlanEventType = "preview_created" | "approved" | "apply_started" | "apply_completed" | "apply_partial" | "apply_failed" | "expired";

export interface BulkPlanOperation {
  index: number;
  itemId: string;
  field: BulkField;
  fieldId: string;
  before: { optionId: string | null; name: string | null };
  after: { optionId: string; name: string };
}

export interface BulkPlanArtifact {
  version: 1;
  projectId: string;
  projectOwner: string;
  projectNumber: number;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  operations: BulkPlanOperation[];
}

export interface BulkPlanEvent {
  type: BulkPlanEventType;
  actorId: string;
  at: string;
  errorCode?: string;
}

export interface BulkPlanItemResult {
  index: number;
  itemId: string;
  field: BulkField;
  outcome: "success" | "no_change" | "failed";
  changed: boolean;
  verified: boolean;
  auditId: string | null;
  errorCode: string | null;
}

export interface BulkPlan {
  planId: string;
  planDigest: string;
  artifact: BulkPlanArtifact;
  state: BulkPlanState;
  approvedBy: string | null;
  approvedAt: string | null;
  applyStartedAt: string | null;
  completedAt: string | null;
  results: BulkPlanItemResult[];
  events: BulkPlanEvent[];
}

export function bulkPlanDigest(artifact: BulkPlanArtifact): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("base64url");
}

export function createBulkPlan(artifact: BulkPlanArtifact): BulkPlan {
  return {
    planId: `bulk-plan-${randomUUID()}`,
    planDigest: bulkPlanDigest(artifact),
    artifact,
    state: "previewed",
    approvedBy: null,
    approvedAt: null,
    applyStartedAt: null,
    completedAt: null,
    results: [],
    events: [{ type: "preview_created", actorId: artifact.createdBy, at: artifact.createdAt }],
  };
}

export function bulkErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] ?? "UNEXPECTED_WRITE_ERROR";
}

export function assertBulkPlanValid(value: unknown): asserts value is BulkPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DURABLE_BULK_PLAN_INVALID: Stored plan is not an object.");
  }
  const plan = value as Partial<BulkPlan>;
  const artifact = plan.artifact as Partial<BulkPlanArtifact> | undefined;
  const exactKeys = (candidate: object, keys: string[]) => Object.keys(candidate).sort().join("\0") === [...keys].sort().join("\0");
  if (!exactKeys(plan, ["planId", "planDigest", "artifact", "state", "approvedBy", "approvedAt", "applyStartedAt", "completedAt", "results", "events"]) ||
      typeof plan.planId !== "string" || !plan.planId.startsWith("bulk-plan-") || plan.planId.length > 128 ||
      typeof plan.planDigest !== "string" || plan.planDigest.length !== 43 ||
      !artifact || !exactKeys(artifact, ["version", "projectId", "projectOwner", "projectNumber", "createdBy", "createdAt", "expiresAt", "operations"]) ||
      artifact.version !== 1 || typeof artifact.projectId !== "string" || artifact.projectId.length < 1 || artifact.projectId.length > 256 ||
      typeof artifact.projectOwner !== "string" || artifact.projectOwner.length < 1 || artifact.projectOwner.length > 256 ||
      !Number.isInteger(artifact.projectNumber) || Number(artifact.projectNumber) < 1 ||
      typeof artifact.createdBy !== "string" || artifact.createdBy.length < 1 || artifact.createdBy.length > 256 ||
      typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt)) ||
      typeof artifact.expiresAt !== "string" || !Number.isFinite(Date.parse(artifact.expiresAt)) ||
      !Array.isArray(artifact.operations) || artifact.operations.length < 1 || artifact.operations.length > 20 ||
      !["previewed", "approved", "applying", "completed", "partial", "failed", "expired"].includes(String(plan.state)) ||
      !(plan.approvedBy === null || (typeof plan.approvedBy === "string" && plan.approvedBy.length <= 256)) ||
      !(plan.approvedAt === null || (typeof plan.approvedAt === "string" && Number.isFinite(Date.parse(plan.approvedAt)))) ||
      !(plan.applyStartedAt === null || (typeof plan.applyStartedAt === "string" && Number.isFinite(Date.parse(plan.applyStartedAt)))) ||
      !(plan.completedAt === null || (typeof plan.completedAt === "string" && Number.isFinite(Date.parse(plan.completedAt)))) ||
      !Array.isArray(plan.results) || plan.results.length > 20 || !Array.isArray(plan.events) || plan.events.length > 8) {
    throw new Error("DURABLE_BULK_PLAN_INVALID: Stored plan failed validation.");
  }
  for (const [index, operation] of artifact.operations.entries()) {
    if (!operation || !operation.before || !operation.after ||
        !exactKeys(operation, ["index", "itemId", "field", "fieldId", "before", "after"]) ||
        !exactKeys(operation.before, ["optionId", "name"]) || !exactKeys(operation.after, ["optionId", "name"]) ||
        operation.index !== index || typeof operation.itemId !== "string" || operation.itemId.length > 256 ||
        typeof operation.fieldId !== "string" || operation.fieldId.length < 1 || operation.fieldId.length > 256 ||
        !["Status", "Priority"].includes(operation.field) ||
        !(operation.before.optionId === null || (typeof operation.before.optionId === "string" && operation.before.optionId.length > 0 && operation.before.optionId.length <= 256)) ||
        !(operation.before.name === null || (typeof operation.before.name === "string" && operation.before.name.length > 0 && operation.before.name.length <= 256)) ||
        (operation.before.optionId === null) !== (operation.before.name === null) ||
        typeof operation.after.optionId !== "string" || operation.after.optionId.length < 1 || operation.after.optionId.length > 256 ||
        typeof operation.after.name !== "string" || operation.after.name.length < 1 || operation.after.name.length > 256) {
      throw new Error("DURABLE_BULK_PLAN_INVALID: Stored operation failed validation.");
    }
  }
  for (const result of plan.results) {
    const operation = artifact.operations[result?.index ?? -1];
    if (!result || !exactKeys(result, ["index", "itemId", "field", "outcome", "changed", "verified", "auditId", "errorCode"]) ||
        !Number.isInteger(result.index) || result.index < 0 || result.index >= artifact.operations.length ||
        plan.results.indexOf(result) !== result.index || !operation || operation.itemId !== result.itemId || operation.field !== result.field ||
        typeof result.itemId !== "string" || result.itemId.length > 256 || !["Status", "Priority"].includes(result.field) ||
        !["success", "no_change", "failed"].includes(result.outcome) || typeof result.changed !== "boolean" ||
        typeof result.verified !== "boolean" || !(result.auditId === null || (typeof result.auditId === "string" && result.auditId.length <= 128)) ||
        !(result.errorCode === null || (typeof result.errorCode === "string" && result.errorCode.length <= 128))) {
      throw new Error("DURABLE_BULK_PLAN_INVALID: Stored result failed validation.");
    }
  }
  for (const event of plan.events) {
    const keys = ["type", "actorId", "at", ...(event && "errorCode" in event ? ["errorCode"] : [])];
    if (!event || !exactKeys(event, keys) ||
        !["preview_created", "approved", "apply_started", "apply_completed", "apply_partial", "apply_failed", "expired"].includes(event.type) ||
        typeof event.actorId !== "string" || event.actorId.length > 256 ||
        typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) ||
        !(event.errorCode === undefined || (typeof event.errorCode === "string" && event.errorCode.length <= 128))) {
      throw new Error("DURABLE_BULK_PLAN_INVALID: Stored event failed validation.");
    }
  }
  const approvalPresent = typeof plan.approvedBy === "string" && typeof plan.approvedAt === "string";
  const applyingPresent = typeof plan.applyStartedAt === "string";
  const terminalPresent = typeof plan.completedAt === "string";
  if (plan.events[0]?.type !== "preview_created" || plan.events[0].actorId !== artifact.createdBy ||
      plan.events[0].at !== artifact.createdAt ||
      (plan.state === "previewed" && (approvalPresent || applyingPresent || terminalPresent || plan.results.length > 0)) ||
      (plan.state === "approved" && (!approvalPresent || applyingPresent || terminalPresent || plan.results.length > 0)) ||
      (plan.state === "applying" && (!approvalPresent || !applyingPresent || terminalPresent || plan.results.length > 0)) ||
      (["completed", "partial"].includes(plan.state as string) && (!approvalPresent || !applyingPresent || !terminalPresent || plan.results.length < 1)) ||
      (plan.state === "expired" && (!terminalPresent || applyingPresent || plan.results.length > 0)) ||
      (plan.state === "completed" && (plan.results.length !== artifact.operations.length || plan.results.some((item) => item.outcome === "failed"))) ||
      (plan.state === "partial" && (plan.results.length < 2 || plan.results.at(-1)?.outcome !== "failed")) ||
      (plan.state === "failed" && (!terminalPresent || (plan.results.length > 0 && (plan.results.length !== 1 || plan.results[0]?.outcome !== "failed"))))) {
    throw new Error("DURABLE_BULK_PLAN_INVALID: Stored lifecycle state is inconsistent.");
  }
  if (bulkPlanDigest(artifact as BulkPlanArtifact) !== plan.planDigest) {
    throw new Error("DURABLE_BULK_PLAN_INVALID: Plan artifact digest mismatch.");
  }
}
