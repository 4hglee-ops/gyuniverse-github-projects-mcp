import assert from "node:assert/strict";
import test from "node:test";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { GitHubRestClient } from "../../github/rest-client.js";
import { type ProjectView, type ViewField } from "../../github/project-views.js";
import { VIEW_TEMPLATES } from "../../project-foundation/view-templates.js";
import { ProjectService } from "../projects/project-service.js";
import { principalForRole, type AuthenticatedPrincipal } from "../identity/principal.js";
import { AuditService } from "../audit/audit-service.js";
import { MemoryWriteAuditStore } from "../audit/audit-store.js";
import type { RecordWriteAuditInput } from "../../workflow/write-audit.js";
import { MemoryViewPlanStore } from "./view-plan-store.js";
import { ProjectViewService } from "./project-view-service.js";
import { type ViewPlan, type ViewApplyInput } from "./view-plan.js";

const end = { hasNextPage: false, endCursor: null };
const connection = (nodes: unknown[] = []) => ({ nodes, pageInfo: end });
const reference = (plan: ViewPlan): ViewApplyInput => ({ owner: "fixture-org", number: 3, planId: plan.planId, planDigest: plan.planDigest, approved: true });
const admin = () => principalForRole("fixture-admin", "admin", { projectIds: ["PVT"] });

function setup(options: { principal?: AuthenticatedPrincipal; store?: MemoryViewPlanStore; auditStore?: MemoryWriteAuditStore; writeEnabled?: boolean } = {}) {
  const names = ["Title", "Status", "Priority", "Part", "Assignees", "Start date", "Target date", "Effort", "WBS Code", "Target", "Repository", "Linked pull requests", "Reviewers"];
  const fields: ViewField[] = names.map((name, i) => ({ id: "F" + i, restId: i + 1, name,
    dataType: ["Status", "Priority", "Part"].includes(name) ? "SINGLE_SELECT" : "TEXT",
    options: name === "Status" ? ["Backlog", "Todo", "In Progress", "In Review", "Done"] : name === "Priority" ? ["P0", "P1", "P2", "P3"] : name === "Part" ? ["Fixture part"] : [],
  }));
  const views: ProjectView[] = [];
  let writes = 0, requests = 0, writable = true, failAt = 0, loseResponse = false;
  let beforeCreate: (() => Promise<void>) | undefined;
  let onRead: ((query: string) => void) | undefined;
  let time = Date.now();
  const config = { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT", "OTHER"], writeEnabled: options.writeEnabled ?? true };
  const principal = options.principal ?? admin();
  const field = (id: string) => fields.find((f) => f.id === id)!;
  const node = (v: ProjectView) => ({ ...v, fields: connection(v.visibleFieldIds.map((id) => ({ id, name: field(id).name }))),
    groupByFields: connection(v.groupByFields.map((name) => fields.find((f) => f.name === name))),
    verticalGroupByFields: connection(v.verticalGroupByFields.map((name) => fields.find((f) => f.name === name))),
    sortByFields: connection(v.sortBy.map((s) => ({ field: fields.find((f) => f.name === s.field), direction: s.direction.toUpperCase() }))),
  });
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
      requests++;
      if (query.includes("mutation")) {
        assert.match(query, /updateProjectV2View/);
        writes++;
        const input = vars.input as { viewId: string; name?: string; filter?: string; layout?: string; configuration?: { visibleFieldIds: string[] } };
        const v = views.find((v) => v.id === input.viewId)!;
        if (input.name !== undefined) v.name = input.name;
        if (input.filter !== undefined) v.filter = input.filter;
        if (input.layout !== undefined) v.layout = input.layout;
        if (input.configuration) { v.visibleFieldIds = input.configuration.visibleFieldIds; v.visibleFields = v.visibleFieldIds.map((id) => field(id).name); }
        return { updateProjectV2View: { projectV2View: { id: v.id } } } as T;
      }
      onRead?.(query);
      if (query.includes("query ViewFields")) return { repositoryOwner: { projectV2: { fields: connection(fields.map((f) => ({ ...f, options: f.options.map((name) => ({ name })) }))) } } } as T;
      const p = { id: vars.number === 2 ? "OTHER" : "PVT", number: vars.number, title: "Fixture Project", url: null, viewerCanUpdate: writable,
        views: connection(views.map(node)) };
      return { repositoryOwner: { __typename: "Organization", projectV2: p } } as T;
    }
  }
  class Rest extends GitHubRestClient {
    override async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
      requests++;
      if (method === "GET") return fields.map((f) => ({ id: f.restId, node_id: f.id })) as T;
      assert.match(path, /^\/orgs\/fixture-org\/projectsV2\/3\/views$/);
      if (beforeCreate) await beforeCreate();
      writes++;
      if (writes === failAt) throw new Error("GitHub REST request failed (503): private-response");
      const input = body as { name: string; layout: string; filter?: string; visible_fields?: number[]; group_by?: number[]; vertical_group_by?: number[]; sort_by?: Array<[number, "asc" | "desc"]> };
      const restField = (id: number) => fields.find((f) => f.restId === id)!;
      const id = "V" + (views.length + 1);
      views.push({ id, number: views.length + 1, name: input.name, layout: input.layout.toUpperCase() + "_LAYOUT", filter: input.filter ?? null,
        visibleFieldIds: (input.visible_fields ?? (input.layout === "roadmap" ? [1] : [])).map((n) => restField(n).id),
        visibleFields: (input.visible_fields ?? (input.layout === "roadmap" ? [1] : [])).map((n) => restField(n).name),
        groupByFields: (input.group_by ?? []).map((n) => restField(n).name), verticalGroupByFields: (input.vertical_group_by ?? []).map((n) => restField(n).name),
        sortBy: (input.sort_by ?? []).map(([n, direction]) => ({ field: restField(n).name, direction })),
      });
      if (loseResponse) throw new Error("GitHub REST request failed (503): response lost after commit");
      return { value: { node_id: id } } as T;
    }
  }
  const client = new Client("synthetic-unused"), rest = new Rest("synthetic-unused");
  const store = options.store ?? new MemoryViewPlanStore();
  const audit = new AuditService(200, options.auditStore ?? new MemoryWriteAuditStore());
  const service = new ProjectViewService({ config, client, rest, principal, projects: new ProjectService({ config, client, principal }), store, audit, now: () => new Date(time) });
  return { service, fields, views, store, audit, get writes() { return writes; }, get requests() { return requests; },
    failAt: (n: number) => { failAt = n; }, loseResponse: () => { loseResponse = true; }, pause: (fn: () => Promise<void>) => { beforeCreate = fn; },
    advance: (ms: number) => { time += ms; }, revoke: () => { writable = false; },
    onRead: (fn: (query: string) => void) => { onRead = fn; },
  };
}
const preview = (s: ReturnType<typeof setup>) => s.service.preview({ owner: "fixture-org", number: 3, template: "wbs-v1" });

test("WBS preview performs zero mutations, includes Backlog Board and marks Roadmap manual work", async () => {
  const s = setup(), plan = await preview(s);
  assert.equal(s.writes, 0);
  assert.equal(plan.artifact.actions.length, 6);
  assert.ok(plan.artifact.actions.every((a) => a.action === "create"));
  const board = plan.artifact.actions.find((a) => a.name === "진행 Board")!;
  assert.equal(board.create!.filter, undefined);
  assert.ok(board.create!.vertical_group_by?.every(Number.isSafeInteger));
  assert.ok(plan.artifact.actions.find((a) => a.name === "일정 Roadmap")!.manual.length > 0);
  assert.match(plan.artifact.actions.find((a) => a.name === "전체 WBS")!.manual.join(" "), /Parent issue/);
});
test("Create verifies each View, preserves fields, audits and replay does not duplicate mutations", async () => {
  const s = setup(), fields = structuredClone(s.fields), plan = await preview(s);
  const result = await s.service.apply(reference(plan));
  assert.equal(result.state, "completed");
  assert.equal(result.results.filter((r) => r.verified).length, 6);
  assert.equal(result.manualRequired, true);
  assert.equal(s.writes, 6);
  assert.deepEqual(s.fields, fields);
  const log = await s.audit.list();
  assert.equal(log.entries.filter((e) => e.outcome === "success" && e.capability === "project.view.write").length, 6);
  await s.service.apply(reference(plan));
  assert.equal(s.writes, 6);
  const second = await preview(s);
  assert.ok(second.artifact.actions.every((a) => a.action === "skip-compatible"));
  await s.service.apply(reference(second));
  assert.equal(s.writes, 6);
});
test("Existing conflicting/duplicate names require manual review; missing fields/options are blocked", async () => {
  const s = setup();
  await s.service.apply(reference(await preview(s)));
  s.views[0]!.filter = "preserve-my-filter";
  assert.equal((await preview(s)).artifact.actions[0]!.action, "manual-review");
  s.views.push({ ...structuredClone(s.views[0]!), id: "duplicate" });
  assert.equal((await preview(s)).artifact.actions[0]!.action, "manual-review");
  const missing = setup(); missing.fields.splice(0, 1);
  const blocked = await preview(missing);
  assert.ok(blocked.artifact.actions.some((a) => a.action === "blocked"));
  await assert.rejects(() => missing.service.apply(reference(blocked)), /VIEW_PLAN_BLOCKED/);
  assert.equal(missing.writes, 0);
});
test("Viewer/Member and narrowed Admin capabilities cannot apply even with an approved plan reference", async () => {
  const principals = [
    ...(["viewer", "member"] as const).map((role) => principalForRole(role, role, { projectIds: ["PVT"] })),
    principalForRole("narrow", "admin", { projectIds: ["PVT"], permissions: ["project.read", "project.write"] }),
    ...([["project.read", "project.write"], ["project.read", "project.view.write"]] as const).map((permissions) => ({ ...admin(), resourcePermissions: { PVT: [...permissions] } })),
  ];
  for (const principal of principals) {
    const s = setup({ principal }), plan = await preview(s);
    await assert.rejects(() => s.service.apply(reference(plan)), /PERMISSION_DENIED/);
    assert.equal(s.writes, 0);
  }
});
test("Read-only effective scope, unassigned Project, wrong owner and GitHub write revocation fail closed", async () => {
  const readOnly = setup({ writeEnabled: false });
  await assert.rejects(async () => readOnly.service.apply(reference(await preview(readOnly))), /write tools are disabled/);
  const outsider = setup({ principal: principalForRole("outsider", "admin", { projectIds: ["OTHER"] }) });
  await assert.rejects(() => preview(outsider), /PROJECT_MEMBERSHIP_DENIED/);
  const s = setup();
  await assert.rejects(() => s.service.list("other-org", 3), /not allowed/);
  await assert.rejects(() => s.service.list("fixture-org", 2), /PROJECT_MEMBERSHIP_DENIED/);
  const plan = await preview(s); s.revoke();
  await assert.rejects(() => s.service.apply(reference(plan)), /PERMISSION_DENIED/);
  assert.equal(s.writes, 0);
});
test("Wrong digest, target, kind, expiry and stale View/field state cause zero writes", async () => {
  const s = setup(), plan = await preview(s), ref = reference(plan);
  await assert.rejects(() => s.service.apply({ ...ref, planDigest: "x".repeat(43) }), /VIEW_PLAN_MISMATCH/);
  await assert.rejects(() => s.service.apply({ ...ref, number: 2 }), /VIEW_PLAN_MISMATCH/);
  await assert.rejects(() => s.service.apply(ref, "update"), /VIEW_PLAN_MISMATCH/);
  s.fields[0]!.name = "Renamed field";
  await assert.rejects(() => s.service.apply(ref), /VIEW_PLAN_STALE/);
  const ttl = setup(), expired = await preview(ttl); ttl.advance(900_001);
  await assert.rejects(() => ttl.service.apply(reference(expired)), /VIEW_PLAN_EXPIRED/);
  assert.equal(s.writes + ttl.writes, 0);
});

test("A plan expiring during the final pre-mutation read still performs zero writes", async () => {
  const s = setup(), plan = await preview(s);
  let reads = 0;
  s.onRead((query) => { if (query.includes("query ProjectViews") && ++reads === 2) s.advance(900_001); });
  const result = await s.service.apply(reference(plan));
  assert.equal(result.state, "failed");
  assert.equal(result.errorCode, "VIEW_PLAN_EXPIRED");
  assert.equal(s.writes, 0);
});
test("Same plan and different plans for one Project cannot apply concurrently", async () => {
  const s = setup(), one = await preview(s), two = await preview(s);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; }), gate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  s.pause(async () => { if (first) { first = false; enter(); await gate; } });
  const applying = s.service.apply(reference(one));
  await entered;
  await assert.rejects(() => s.service.apply(reference(one)), /VIEW_PLAN_IN_PROGRESS/);
  await assert.rejects(() => s.service.apply(reference(two)), /VIEW_PLAN_IN_PROGRESS/);
  release();
  assert.equal((await applying).state, "completed");
  assert.equal(s.writes, 6);
});
test("Intermediate failure reports partial results and replay/fresh plan never duplicate uncertain writes", async () => {
  const s = setup(); s.failAt(2);
  const plan = await preview(s), result = await s.service.apply(reference(plan));
  assert.equal(result.state, "partial");
  assert.equal(result.results[0]!.verified, true);
  assert.equal(result.results[1]!.changed, null);
  assert.equal(result.errorCode, "VIEW_UPSTREAM_503");
  await s.service.apply(reference(plan));
  await assert.rejects(async () => s.service.apply(reference(await preview(s))), /VIEW_PLAN_IN_PROGRESS/);
  assert.equal(s.writes, 2);
});
test("Lost response after upstream commit retains uncertainty and does not recreate the View", async () => {
  const s = setup(); s.loseResponse();
  const plan = await preview(s), result = await s.service.apply(reference(plan));
  assert.equal(result.state, "partial");
  assert.equal(s.views.length, 1);
  await s.service.apply(reference(plan));
  assert.equal((await preview(s)).artifact.actions[0]!.action, "skip-compatible");
  assert.equal(s.writes, 1);
});
test("Audit failures before and after mutation stop safely and replay cannot repeat the mutation", async () => {
  class FailingAudit extends MemoryWriteAuditStore {
    calls = 0;
    constructor(private readonly at: number) { super(); }
    override async append(input: RecordWriteAuditInput) { if (++this.calls === this.at) throw new Error("synthetic audit unavailable"); return super.append(input); }
  }
  for (const at of [1, 2]) {
    const s = setup({ auditStore: new FailingAudit(at) }), plan = await preview(s);
    const result = await s.service.apply(reference(plan));
    assert.equal(result.errorCode, "AUDIT_PERSISTENCE_FAILED");
    assert.equal(result.state, at === 1 ? "failed" : "partial");
    await s.service.apply(reference(plan));
    assert.equal(s.writes, at === 1 ? 0 : 1);
  }
});
test("Finalization failure before or after persistence never silently reruns mutations", async () => {
  for (const afterPersist of [false, true]) {
    class UncertainStore extends MemoryViewPlanStore {
      override async finish(plan: ViewPlan) { if (afterPersist) await super.finish(plan); throw new Error("synthetic finalization loss"); }
    }
    const s = setup({ store: new UncertainStore() }), plan = await preview(s);
    const result = await s.service.apply(reference(plan));
    assert.equal(result.finalizationUncertain, true);
    if (afterPersist) assert.equal((await s.service.apply(reference(plan))).state, "completed");
    else await assert.rejects(() => s.service.apply(reference(plan)), /VIEW_PLAN_IN_PROGRESS/);
    assert.equal(s.writes, 6);
  }
});
test("Supported update requires a preview, preserves grouping/sorting and rejects foreign field IDs", async () => {
  const s = setup(); await s.service.apply(reference(await preview(s)));
  const v = s.views[2]!, before = structuredClone(v), writes = s.writes;
  const plan = await s.service.preview({ owner: "fixture-org", number: 3, update: { viewId: v.id, changes: { name: "Renamed", filter: "status:Backlog" } } });
  assert.equal(plan.artifact.actions[0]!.action, "update-supported");
  assert.equal((await s.service.apply(reference(plan), "update")).state, "completed");
  assert.equal(v.name, "Renamed");
  assert.deepEqual(v.groupByFields, before.groupByFields);
  assert.deepEqual(v.sortBy, before.sortBy);
  const layoutPlan = await s.service.preview({ owner: "fixture-org", number: 3, update: { viewId: v.id, changes: { layout: "board" } } });
  assert.equal(layoutPlan.artifact.actions[0]!.action, "manual-review");
  await s.service.apply(reference(plan), "update");
  assert.equal(s.writes, writes + 1);
  await assert.rejects(() => s.service.preview({ owner: "fixture-org", number: 3, update: { viewId: v.id, changes: { visibleFieldIds: ["FOREIGN"] } } }), /VIEW_FIELD_INVALID/);
  await assert.rejects(() => s.service.preview({ owner: "fixture-org", number: 3, update: { viewId: "FOREIGN", changes: { name: "x" } } }), /VIEW_NOT_FOUND/);
  assert.equal(VIEW_TEMPLATES["wbs-v1"].length, 6);
});
