import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import type { GitHubRestClient } from "../../github/rest-client.js";
import {
  createProjectView, updateProjectView, readProjectViews, readViewFields, readRestViewFieldIds, graphLayout,
  type ProjectView, type ViewField, type ViewState,
} from "../../github/project-views.js";
import { VIEW_TEMPLATES, type ViewTemplateSpec } from "../../project-foundation/view-templates.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";
import { WritePolicy } from "../policy/write-policy.js";
import { projectIdOf, type ProjectService } from "../projects/project-service.js";
import type { AuditService } from "../audit/audit-service.js";
import { createViewPlanStore } from "./view-plan-store-factory.js";
import type { ViewPlanStore } from "./view-plan-store.js";
import {
  createViewPlan, viewDigest, viewStateDigest, viewTargetSchema, viewPreviewSchema, viewApplySchema,
  type ViewAction, type ViewExpectation, type ViewPlan, type ViewResult, type ViewPreviewInput, type ViewApplyInput,
} from "./view-plan.js";

const errorCode = (e: unknown) => /^([A-Z][A-Z0-9_]+):/.exec(e instanceof Error ? e.message : "")?.[1] ?? "VIEW_OPERATION_FAILED";
export function viewExpectation(v: ProjectView): ViewExpectation {
  return { name: v.name, layout: v.layout as ViewExpectation["layout"], filter: v.filter ?? "", visibleFieldIds: v.layout === "ROADMAP_LAYOUT" ? [] : v.visibleFieldIds,
    groupByFields: v.groupByFields, verticalGroupByFields: v.verticalGroupByFields, sortBy: v.sortBy };
}

export function planTemplateViews(state: ViewState, fields: ViewField[], specs: readonly ViewTemplateSpec[], mappingError?: string): ViewAction[] {
  return specs.map((spec) => {
    const base: ViewAction = { action: "blocked", name: spec.name, reason: "", manual: [...(spec.manual ?? [])], viewId: null, create: null, changes: null, expected: null };
    const matches = state.views.filter((v) => v.name === spec.name);
    if (matches.length > 1) return { ...base, action: "manual-review", reason: "Multiple existing views have this name; preserve them." };
    const names = [...new Set([...spec.visibleFields, ...(spec.groupBy ? [spec.groupBy] : []), ...(spec.verticalGroupBy ? [spec.verticalGroupBy] : []), ...(spec.sortBy?.map(([f]) => f) ?? []), ...Object.keys(spec.requiredOptions ?? {})])];
    const byName = new Map<string, ViewField>();
    for (const name of names) {
      const candidates = fields.filter((f) => f.name === name);
      if (candidates.length !== 1) return { ...base, reason: `Missing or ambiguous field: ${name}. Existing fields are preserved.` };
      byName.set(name, candidates[0]!);
    }
    for (const [name, options] of Object.entries(spec.requiredOptions ?? {})) {
      const field = byName.get(name)!;
      if (field.dataType !== "SINGLE_SELECT" || options.some((o) => !field.options.includes(o))) return { ...base, reason: `Required filter options are absent in ${name}; no options will be changed.` };
    }
    for (const name of [spec.groupBy, spec.verticalGroupBy].filter((n): n is string => !!n)) {
      if (!["SINGLE_SELECT", "ITERATION", "ASSIGNEES", "REPOSITORY", "MILESTONE", "ISSUE_TYPE"].includes(byName.get(name)!.dataType)) {
        return { ...base, reason: `Grouping by ${name} with this field type is unsupported or unverified.` };
      }
    }
    const expected: ViewExpectation = { name: spec.name, layout: graphLayout(spec.layout) as ViewExpectation["layout"], filter: spec.filter ?? "",
      visibleFieldIds: spec.visibleFields.map((n) => byName.get(n)!.id),
      groupByFields: spec.groupBy ? [spec.groupBy] : [], verticalGroupByFields: spec.verticalGroupBy ? [spec.verticalGroupBy] : [],
      sortBy: spec.sortBy?.map(([field, direction]) => ({ field, direction })) ?? [],
    };
    if (matches[0]) {
      const v = matches[0], actual = viewExpectation(v);
      const compatible = actual.layout === expected.layout && actual.filter === expected.filter
        && expected.visibleFieldIds.every((id) => actual.visibleFieldIds.includes(id))
        && viewDigest(actual.groupByFields) === viewDigest(expected.groupByFields)
        && viewDigest(actual.verticalGroupByFields) === viewDigest(expected.verticalGroupByFields)
        && viewDigest(actual.sortBy) === viewDigest(expected.sortBy);
      return { ...base, action: compatible ? "skip-compatible" : "manual-review", viewId: v.id,
        reason: compatible ? "Compatible view is preserved." : "Existing view differs; use an explicit supported update plan or GitHub UI." };
    }
    if (state.project.ownerType !== "Organization") return { ...base, reason: "Grouped template creation currently supports organization-owned Projects only." };
    if (names.some((n) => byName.get(n)!.restId === null)) return { ...base, reason: mappingError ?? "Required integer REST field IDs are unavailable." };
    const restId = (n: string) => byName.get(n)!.restId!;
    return { ...base, action: "create", reason: "View is missing; create without changing items or fields.", expected,
      create: { name: spec.name, layout: spec.layout, ...(spec.filter ? { filter: spec.filter } : {}),
        ...(spec.layout !== "roadmap" ? { visible_fields: spec.visibleFields.map(restId) } : {}),
        ...(spec.groupBy ? { group_by: [restId(spec.groupBy)] } : {}), ...(spec.verticalGroupBy ? { vertical_group_by: [restId(spec.verticalGroupBy)] } : {}),
        ...(spec.sortBy ? { sort_by: spec.sortBy.map(([name, direction]) => [restId(name), direction]) } : {}),
      } };
  });
}

export interface ProjectViewServiceOptions {
  config: AppConfig; client: GitHubGraphQlClient; rest: GitHubRestClient;
  projects: Pick<ProjectService, "resolveProject">; principal: AuthenticatedPrincipal | null; audit: AuditService;
  store?: ViewPlanStore; now?: () => Date;
  assertCurrentWrite?: (projectId: string) => Promise<void>;
}
export class ProjectViewService {
  constructor(private readonly options: ProjectViewServiceOptions) {}
  private get store() { return this.options.store ?? createViewPlanStore(); }
  private now() { return (this.options.now ?? (() => new Date()))(); }

  private async context(owner: string, number: number, includeFields = false, includeRest = false) {
    viewTargetSchema.parse({ owner, number });
    const p = await this.options.projects.resolveProject(owner, number);
    const state = await readProjectViews(this.options.client, owner, number);
    if (state.project.id !== projectIdOf(p)) throw new Error("VIEW_PROJECT_MISMATCH: Project identity changed.");
    const fields = includeFields ? await readViewFields(this.options.client, owner, number) : [];
    let mappingError: string | undefined;
    if (includeRest && state.project.ownerType === "Organization") {
      try {
        const ids = await readRestViewFieldIds(this.options.rest, owner, number);
        for (const f of fields) f.restId = ids.get(f.id) ?? null;
      } catch (error) { mappingError = errorCode(error); }
    }
    return { state, fields, mappingError };
  }
  async list(owner: string, number: number) {
    const { state } = await this.context(owner, number);
    return { ...state, complete: true, limitations: ["Roadmap date selection is not verified. Group/sort changes require GitHub UI; creation supports them through REST."] };
  }
  async preview(input: ViewPreviewInput) {
    input = viewPreviewSchema.parse(input);
    const actor = this.options.principal;
    if (!actor) throw new Error("IDENTITY_REQUIRED: View plans require an authenticated principal.");
    const { state, fields, mappingError } = await this.context(input.owner, input.number, true, !!input.template);
    let actions: ViewAction[];
    if (input.template) actions = planTemplateViews(state, fields, VIEW_TEMPLATES[input.template], mappingError);
    else {
      const update = input.update!, v = state.views.find((v) => v.id === update.viewId);
      if (!v) throw new Error("VIEW_NOT_FOUND: View does not belong to this Project.");
      if (update.changes.visibleFieldIds && (new Set(update.changes.visibleFieldIds).size !== update.changes.visibleFieldIds.length
        || update.changes.visibleFieldIds.some((id) => !fields.some((f) => f.id === id)))) throw new Error("VIEW_FIELD_INVALID: Visible fields must belong to this Project.");
      const { layout, ...other } = update.changes;
      const expected = { ...viewExpectation(v), ...other, ...(layout ? { layout: graphLayout(layout) as ViewExpectation["layout"] } : {}) };
      if (expected.layout === "ROADMAP_LAYOUT") expected.visibleFieldIds = [];
      const conflict = state.views.some((other) => other.id !== v.id && other.name === expected.name)
        || (expected.layout === "ROADMAP_LAYOUT" && !!update.changes.visibleFieldIds)
        || (expected.layout !== v.layout && (v.groupByFields.length > 0 || v.verticalGroupByFields.length > 0 || v.sortBy.length > 0));
      const unchanged = viewDigest(viewExpectation(v)) === viewDigest(expected);
      actions = [{ action: conflict ? "manual-review" : unchanged ? "skip-compatible" : "update-supported", name: expected.name,
        reason: conflict ? "Name conflict, grouped/sorted layout change or Roadmap field configuration requires manual review." : "Only name, filter, layout and visible fields can be updated.",
        manual: expected.layout === "ROADMAP_LAYOUT" ? ["Verify Roadmap date configuration in GitHub UI."] : [],
        viewId: v.id, create: null, changes: conflict || unchanged ? null : update.changes, expected: conflict || unchanged ? null : expected }];
    }
    const created = this.now();
    const plan = createViewPlan({ version: 1, kind: input.template ? "template" : "update", owner: input.owner, number: input.number,
      projectId: state.project.id, createdBy: actor.id, createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + 15 * 60_000).toISOString(),
      baselineDigest: viewStateDigest(state, fields), actions });
    await this.store.create(plan);
    return { ...plan, persistence: this.store.persistence, ttlSeconds: 900 };
  }
  private authorize(projectId: string) {
    if (this.options.principal?.role !== "admin") throw new Error("PERMISSION_DENIED: Only an authenticated Admin may change Views.");
    return new WritePolicy(this.options.config, this.options.principal).authorize({ operation: "configure_project_views", projectId });
  }
  private unexpired(plan: ViewPlan) {
    if (Date.parse(plan.artifact.expiresAt) <= this.now().getTime()) throw new Error("VIEW_PLAN_EXPIRED: Create a fresh preview.");
  }
  private report(plan: ViewPlan, finalizationUncertain = false) {
    return { ...plan, persistence: this.store.persistence, finalizationUncertain, retryable: false as const,
      manualRequired: finalizationUncertain || plan.state === "partial" || plan.state === "failed" || plan.artifact.actions.some((a) => a.manual.length > 0 || a.action === "manual-review"),
      userAction: finalizationUncertain ? "Re-read the target and inspect plan/Project lock state. Do not retry mutations automatically." : "Review verified results and manual items. For failed/partial changes, read current Views and create a new preview." };
  }
  async apply(input: ViewApplyInput, kind: "template" | "update" = "template") {
    input = viewApplySchema.parse(input);
    const plan = await this.store.get(input.planId);
    if (!plan) throw new Error("VIEW_PLAN_NOT_FOUND: Plan is absent or no longer retained.");
    if (input.planDigest !== plan.planDigest || plan.artifact.kind !== kind || plan.artifact.owner !== input.owner || plan.artifact.number !== input.number) throw new Error("VIEW_PLAN_MISMATCH: Use the exact preview target, kind and digest.");
    const project = await this.options.projects.resolveProject(input.owner, input.number);
    if (projectIdOf(project) !== plan.artifact.projectId) throw new Error("VIEW_PROJECT_MISMATCH: Project identity changed.");
    await this.options.assertCurrentWrite?.(plan.artifact.projectId);
    this.authorize(plan.artifact.projectId);
    if (["completed", "partial", "failed"].includes(plan.state)) return this.report(plan);
    if (plan.state === "applying") throw new Error("VIEW_PLAN_IN_PROGRESS: This plan has an unresolved apply; inspect its state.");
    this.unexpired(plan);
    if (plan.artifact.actions.some((a) => a.action === "blocked")) throw new Error("VIEW_PLAN_BLOCKED: Resolve blocked entries and preview again.");
    const before = await this.context(input.owner, input.number, true, kind === "template");
    if (!before.state.project.viewerCanUpdate) throw new Error("PERMISSION_DENIED: GitHub credential cannot update this Project.");
    if (viewStateDigest(before.state, before.fields) !== plan.artifact.baselineDigest) throw new Error("VIEW_PLAN_STALE: Views or fields changed; preview again.");
    if (!(await this.store.claim(plan))) throw new Error("VIEW_PLAN_IN_PROGRESS: Plan or Project is already claimed; inspect its state.");
    const results: ViewResult[] = [];
    let currentAction: ViewAction | undefined, mutationAttempted = false, failure: string | null = null;
    let expectedDigest = plan.artifact.baselineDigest;
    try {
      await this.audit(plan, null, "no_change", false, null, "project_view_apply_started");
      for (const action of plan.artifact.actions) {
        currentAction = action; mutationAttempted = false;
        this.unexpired(plan); this.authorize(plan.artifact.projectId);
        const live = await this.context(input.owner, input.number, true, kind === "template");
        if (viewStateDigest(live.state, live.fields) !== expectedDigest) throw new Error("VIEW_PLAN_STALE: Project state changed during apply.");
        if (!live.state.project.viewerCanUpdate) throw new Error("PERMISSION_DENIED: GitHub write access changed.");
        this.unexpired(plan);
        if (action.action === "manual-review" || action.action === "skip-compatible") {
          results.push({ name: action.name, viewId: action.viewId, changed: false, verified: action.action === "skip-compatible", outcome: action.action === "manual-review" ? "manual-review" : "no_change", errorCode: null });
          continue;
        }
        await this.options.assertCurrentWrite?.(plan.artifact.projectId);
        this.unexpired(plan);
        mutationAttempted = true;
        const viewId = action.action === "create"
          ? await createProjectView(this.options.rest, input.owner, input.number, action.create!)
          : await updateProjectView(this.options.client, action.viewId!, action.changes!);
        const after = await this.context(input.owner, input.number, true, kind === "template");
        const actual = after.state.views.find((v) => v.id === viewId);
        const unchangedBefore = live.state.views.filter((v) => v.id !== (action.viewId ?? viewId)).sort((a, b) => a.id.localeCompare(b.id));
        const unchangedAfter = after.state.views.filter((v) => v.id !== viewId).sort((a, b) => a.id.localeCompare(b.id));
        if (!actual || after.state.views.length !== live.state.views.length + (action.action === "create" ? 1 : 0)
          || (action.action === "create" && live.state.views.some((v) => v.id === viewId))
          || viewDigest(viewExpectation(actual)) !== viewDigest(action.expected)
          || viewDigest(unchangedBefore) !== viewDigest(unchangedAfter) || viewDigest(live.fields) !== viewDigest(after.fields)) {
          throw new Error("VIEW_VERIFICATION_FAILED: Target or surrounding state did not match; do not retry automatically.");
        }
        await this.audit(plan, action, "success", true, null);
        results.push({ name: action.name, viewId, changed: true, verified: true, outcome: "success", errorCode: null });
        expectedDigest = viewStateDigest(after.state, after.fields);
      }
    } catch (error) {
      failure = errorCode(error);
      if (currentAction) results.push({ name: currentAction.name, viewId: currentAction.viewId, changed: mutationAttempted ? null : false, verified: false, outcome: "failed", errorCode: failure });
      try { await this.audit(plan, currentAction ?? null, "failed", false, failure); } catch { failure = "AUDIT_PERSISTENCE_FAILED"; }
    }
    const state = failure ? results.some((r) => r.changed !== false) ? "partial" : "failed"
      : results.some((r) => r.outcome === "manual-review") ? "partial" : "completed";
    const finished: ViewPlan = { ...plan, state, results, errorCode: failure };
    try { await this.store.finish(finished); } catch {
      return this.report({ ...finished, state: "applying", errorCode: "VIEW_PLAN_FINALIZE_UNCERTAIN" }, true);
    }
    return this.report(finished);
  }
  private audit(plan: ViewPlan, action: ViewAction | null, outcome: "success" | "no_change" | "failed", verified: boolean, code: string | null, operation?: string) {
    return this.options.audit.record({ operation: operation ?? (plan.artifact.kind === "update" ? "update_project_view" : "apply_project_view_setup"),
      outcome, verified, errorCode: code, actorId: this.options.principal!.id, capability: "project.view.write", planId: plan.planId,
      projectId: plan.artifact.projectId, projectOwner: plan.artifact.owner, projectNumber: plan.artifact.number,
      itemId: null, fieldName: "Project View", requestedValue: action?.name ?? plan.artifact.kind,
      beforeValue: plan.artifact.baselineDigest, afterValue: verified && action?.expected ? viewDigest(action.expected) : null,
    });
  }
}
