import assert from "node:assert/strict";
import test from "node:test";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { GitHubRestClient } from "../github/rest-client.js";

import {
  DESIRED_VIEWS,
  planProjectViews,
  ProjectFoundationInspection,
  REQUIRED_PRIORITY_OPTIONS,
  REQUIRED_STATUS_OPTIONS,
  TARGET_PROJECT,
  applyProjectOperatingFoundation,
} from "./operating-foundation.js";

function inspection(): ProjectFoundationInspection {
  const fieldNames = [
    "Title", "Priority", "Repository", "Assignees", "Status", "Iteration",
    "Linked pull requests", "Reviewers",
  ];
  return {
    inspectedAt: "2026-09-05T00:00:00.000Z",
    project: { id: TARGET_PROJECT.id, number: 2, title: TARGET_PROJECT.title, url: null, viewerCanUpdate: true },
    fields: fieldNames.map((name, index) => ({
      id: `field-${index}`,
      restId: index + 1,
      name,
      dataType: name === "Iteration" ? "ITERATION" : name === "Status" || name === "Priority" ? "SINGLE_SELECT" : "FIELD",
      options: name === "Status" ? [...REQUIRED_STATUS_OPTIONS] : name === "Priority" ? [...REQUIRED_PRIORITY_OPTIONS] : [],
      iteration: null,
    })),
    status: { compatible: true, actualOptions: [...REQUIRED_STATUS_OPTIONS], requiredOptions: [...REQUIRED_STATUS_OPTIONS] },
    priority: { compatible: true, preserved: true, actualOptions: [...REQUIRED_PRIORITY_OPTIONS], requiredOptions: [...REQUIRED_PRIORITY_OPTIONS] },
    iteration: { exists: true, field: null },
    views: [],
    workflows: [],
    access: { restFieldsReadable: true, viewsReadable: true, workflowsReadable: true },
    capabilityClassification: {
      iteration: "official-graphql-api",
      views: "official-rest-api-create-graphql-read",
      closeAndMergeToDone: "github-project-built-in-workflow",
      autoAdd: "github-project-built-in-workflow",
      readyForReviewToInReview: "repository-github-actions",
    },
    limitations: [],
  };
}

test("plans all five missing views without modifying Priority", () => {
  const plans = planProjectViews(inspection());
  assert.equal(plans.length, DESIRED_VIEWS.length);
  assert.ok(plans.every((plan) => plan.action === "create"));
  assert.deepEqual(plans[0]?.request?.visible_fields, [1, 2, 3, 4]);
  assert.equal(inspection().priority.preserved, true);
});

test("preserves a compatible existing view", () => {
  const state = inspection();
  state.views.push({
    id: "view-1",
    number: 1,
    name: "📥 Backlog",
    layout: "TABLE_LAYOUT",
    filter: "status:Backlog",
    visibleFields: ["Title", "Priority", "Repository", "Assignees"],
    groupByFields: [],
    verticalGroupByFields: [],
  });
  assert.equal(planProjectViews(state)[0]?.action, "skip-compatible");
});

test("reports an incompatible same-name view for manual review", () => {
  const state = inspection();
  state.views.push({
    id: "view-1",
    number: 1,
    name: "🏃 Active Work",
    layout: "TABLE_LAYOUT",
    filter: null,
    visibleFields: ["Title"],
    groupByFields: [],
    verticalGroupByFields: [],
  });
  assert.equal(planProjectViews(state)[1]?.action, "manual-review");
});

test("blocks view creation when a REST field id is unavailable", () => {
  const state = inspection();
  const reviewers = state.fields.find((field) => field.name === "Reviewers");
  assert.ok(reviewers);
  reviewers.restId = null;
  assert.equal(planProjectViews(state)[3]?.action, "blocked");
});

test("workflow detail access does not block readable view planning", () => {
  const state = inspection();
  state.access.workflowsReadable = false;
  assert.ok(planProjectViews(state).every((plan) => plan.action === "create"));
});

test("no-sprint planning does not require an Iteration field", () => {
  const state = inspection();
  state.fields = state.fields.filter((field) => field.name !== "Iteration");
  state.iteration = { exists: false, field: null };

  const plans = planProjectViews(state);
  assert.ok(plans.every((plan) => plan.action === "create"));
  assert.equal(plans[1]?.spec.name, "🏃 Active Work");
  assert.equal(plans[1]?.request?.filter, "status:Todo,\"In Progress\",\"In Review\"");
  assert.ok(plans.every((plan) => !plan.spec.visibleFields.includes("Iteration")));
});

test("Project #2 foundation reuses common View reads/REST mapping and preserves its guarded create/verify flow", async () => {
  const initial = inspection(), views: Array<Record<string, unknown>> = [];
  const queries: string[] = [], writes: string[] = [];
  const end = { hasNextPage: false, endCursor: null };
  const connection = (nodes: unknown[] = []) => ({ nodes, pageInfo: end });
  const rawFields = initial.fields.map((f) => ({ id: f.id, name: f.name, dataType: f.dataType, options: f.options.map((name) => ({ name })) }));
  class Graph extends GitHubGraphQlClient {
    override async request<T>(query: string, vars: Record<string, unknown> = {}): Promise<T> {
      queries.push(query); assert.equal(vars.number, 2); assert.doesNotMatch(query, /mutation/);
      const project = { ...TARGET_PROJECT, viewerCanUpdate: true, url: null,
        fields: connection(rawFields), views: connection(views), workflows: { nodes: [] } };
      return { repositoryOwner: { __typename: "Organization", projectV2: project } } as T;
    }
  }
  class Rest extends GitHubRestClient {
    override async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
      assert.match(path, /\/projectsV2\/2\//);
      if (method === "GET") return initial.fields.map((f) => ({ node_id: f.id, id: f.restId, name: f.name })) as T;
      writes.push(path);
      const input = body as { name: string; layout: string; filter?: string; visible_fields: number[]; group_by?: number[]; vertical_group_by?: number[] };
      const named = (ids: number[] = []) => ids.map((id) => initial.fields.find((f) => f.restId === id)).map((f) => ({ id: f!.id, name: f!.name }));
      views.push({ id: "V" + (views.length + 1), number: views.length + 1, name: input.name, layout: input.layout.toUpperCase() + "_LAYOUT", filter: input.filter ?? null,
        configuration: { visibleFields: connection(named(input.visible_fields)) },
        groupByFields: connection(named(input.group_by)), verticalGroupByFields: connection(named(input.vertical_group_by)), sortByFields: connection() });
      return {} as T;
    }
  }
  const graph = new Graph("synthetic-unused"), rest = new Rest("synthetic-unused");
  const result = await applyProjectOperatingFoundation(graph, rest, { githubToken: "synthetic-unused", allowedOwners: [TARGET_PROJECT.owner], allowedProjectIds: [TARGET_PROJECT.id], writeEnabled: true });
  assert.equal(result.before.project.id, TARGET_PROJECT.id);
  assert.equal(result.after.views.length, 5);
  assert.equal(writes.length, 5);
  assert.ok(planProjectViews(result.after).every((p) => p.action === "skip-compatible"));
  await applyProjectOperatingFoundation(graph, rest, { githubToken: "synthetic-unused", allowedOwners: [TARGET_PROJECT.owner], allowedProjectIds: [TARGET_PROJECT.id], writeEnabled: true });
  assert.equal(writes.length, 5);
  assert.ok(queries.some((q) => q.includes("query ProjectViews")));
  assert.deepEqual(result.after.priority.actualOptions, [...REQUIRED_PRIORITY_OPTIONS]);
});
