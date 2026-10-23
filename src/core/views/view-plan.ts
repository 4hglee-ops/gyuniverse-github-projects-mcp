import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { viewChangesSchema, viewLayout, type ViewState, type ViewField } from "../../github/project-views.js";

export function viewDigest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("base64url");
}
export function viewStateDigest(state: ViewState, fields: ViewField[]): string {
  return viewDigest({ project: state.project.id, views: [...state.views].sort((a, b) => a.id.localeCompare(b.id)), fields: [...fields].sort((a, b) => a.id.localeCompare(b.id)) });
}
const id = z.string().min(1).max(256);
export const expectationSchema = z.object({
  name: z.string().min(1).max(100), layout: z.enum(["TABLE_LAYOUT", "BOARD_LAYOUT", "ROADMAP_LAYOUT"]), filter: z.string().max(1024),
  visibleFieldIds: z.array(id).max(100), groupByFields: z.array(id).max(100), verticalGroupByFields: z.array(id).max(100),
  sortBy: z.array(z.object({ field: id, direction: z.enum(["asc", "desc"]) }).strict()).max(100),
}).strict();
export type ViewExpectation = z.infer<typeof expectationSchema>;
const numericIds = z.array(z.number().int().positive().safe()).max(100);
const restCreate = z.object({
  name: z.string().min(1).max(100), layout: viewLayout, filter: z.string().max(1024).optional(),
  visible_fields: numericIds.optional(), group_by: numericIds.max(1).optional(), vertical_group_by: numericIds.max(1).optional(),
  sort_by: z.array(z.tuple([z.number().int().positive().safe(), z.enum(["asc", "desc"])] )).max(100).optional(),
}).strict();
export const viewActionSchema = z.object({
  action: z.enum(["create", "skip-compatible", "update-supported", "manual-review", "blocked"]),
  name: z.string().min(1).max(100), reason: z.string().max(2048), manual: z.array(z.string().max(512)).max(20),
  viewId: id.nullable(), create: restCreate.nullable(), changes: viewChangesSchema.nullable(), expected: expectationSchema.nullable(),
}).strict().refine((a) => a.action === "create" ? !!a.create && !a.changes && !a.viewId && !!a.expected
  : a.action === "update-supported" ? !!a.changes && !!a.viewId && !a.create && !!a.expected
  : !a.create && !a.changes);
export type ViewAction = z.infer<typeof viewActionSchema>;
const digest = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const viewArtifactSchema = z.object({
  version: z.literal(1), kind: z.enum(["template", "update"]), owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
  number: z.number().int().positive(), projectId: id, createdBy: id, createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  baselineDigest: digest, actions: z.array(viewActionSchema).min(1).max(20),
}).strict();
export type ViewArtifact = z.infer<typeof viewArtifactSchema>;
const resultSchema = z.object({
  name: z.string().max(100), viewId: id.nullable(), changed: z.boolean().nullable(), verified: z.boolean(),
  outcome: z.enum(["success", "no_change", "manual-review", "failed"]), errorCode: z.string().max(100).nullable(),
}).strict();
export type ViewResult = z.infer<typeof resultSchema>;
export const viewPlanSchema = z.object({
  planId: z.string().regex(/^view-plan-[0-9a-f-]{36}$/), planDigest: digest, artifact: viewArtifactSchema,
  state: z.enum(["previewed", "applying", "completed", "partial", "failed"]), results: z.array(resultSchema).max(20),
  errorCode: z.string().max(100).nullable(),
}).strict();
export type ViewPlan = z.infer<typeof viewPlanSchema>;
export function validateViewPlan(raw: unknown): ViewPlan {
  const parsed = viewPlanSchema.safeParse(raw);
  if (!parsed.success || parsed.data.planDigest !== viewDigest(parsed.data.artifact)
    || Date.parse(parsed.data.artifact.expiresAt) <= Date.parse(parsed.data.artifact.createdAt)
    || Date.parse(parsed.data.artifact.expiresAt) - Date.parse(parsed.data.artifact.createdAt) > 15 * 60_000) {
    throw new Error("VIEW_PLAN_INVALID: Stored plan failed validation.");
  }
  return parsed.data;
}
export function createViewPlan(artifact: ViewArtifact): ViewPlan {
  return validateViewPlan({ planId: "view-plan-" + randomUUID(), planDigest: viewDigest(artifact), artifact, state: "previewed", results: [], errorCode: null });
}
export const viewTargetSchema = z.object({ owner: viewArtifactSchema.shape.owner, number: z.number().int().positive() }).strict();
export const viewPreviewSchema = viewTargetSchema.extend({
  template: z.enum(["operating-v1", "wbs-v1"]).optional(),
  update: z.object({ viewId: id, changes: viewChangesSchema }).strict().optional(),
}).strict().refine((v) => Number(!!v.template) + Number(!!v.update) === 1, "Choose exactly one template or View update.");
export const viewApplySchema = viewTargetSchema.extend({
  planId: viewPlanSchema.shape.planId, planDigest: digest, approved: z.literal(true),
}).strict();
export type ViewPreviewInput = z.infer<typeof viewPreviewSchema>;
export type ViewApplyInput = z.infer<typeof viewApplySchema>;
