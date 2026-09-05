import { AppConfig, assertOwnerAllowed, assertProjectAllowed, assertProjectWriteAllowed } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { getProject, listProjectFields } from "../github/projects.js";
import { GitHubRestClient } from "../github/rest-client.js";

export const TARGET_PROJECT = {
  owner: "gyuniverse-hq",
  number: 2,
  id: "PVT_kwDOEzfCi84BidwG",
  title: "Bid Change Validator · WBS",
} as const;

export const REQUIRED_STATUS_OPTIONS = ["Backlog", "Todo", "In Progress", "In Review", "Done"] as const;
export const REQUIRED_PRIORITY_OPTIONS = ["P0", "P1", "P2", "P3"] as const;

export interface FoundationField {
  id: string;
  restId: number | null;
  name: string;
  dataType: string;
  options: string[];
  iteration: {
    duration: number | null;
    startDay: number | null;
    current: { id: string; title: string; startDate: string; duration: number } | null;
    upcoming: Array<{ id: string; title: string; startDate: string; duration: number }>;
    completed: Array<{ id: string; title: string; startDate: string; duration: number }>;
  } | null;
}

export interface FoundationView {
  id: string;
  number: number;
  name: string;
  layout: string;
  filter: string | null;
  visibleFields: string[];
  groupByFields: string[];
  verticalGroupByFields: string[];
}

export interface FoundationWorkflow {
  id: string;
  number: number;
  name: string;
  enabled: boolean;
}

export interface ProjectFoundationInspection {
  inspectedAt: string;
  project: { id: string; number: number; title: string; url: string | null; viewerCanUpdate: boolean | null };
  fields: FoundationField[];
  status: { compatible: boolean; actualOptions: string[]; requiredOptions: string[] };
  priority: { compatible: boolean; preserved: true; actualOptions: string[]; requiredOptions: string[] };
  iteration: { exists: boolean; field: FoundationField | null };
  views: FoundationView[];
  workflows: FoundationWorkflow[];
  access: {
    restFieldsReadable: boolean;
    viewsReadable: boolean;
    workflowsReadable: boolean;
  };
  capabilityClassification: {
    iteration: "official-graphql-api";
    views: "official-rest-api-create-graphql-read";
    closeAndMergeToDone: "github-project-built-in-workflow";
    autoAdd: "github-project-built-in-workflow";
    readyForReviewToInReview: "repository-github-actions";
  };
  limitations: string[];
}

export interface DesiredViewSpec {
  name: string;
  layout: "table" | "board";
  filter?: string;
  visibleFields: string[];
  groupBy?: string;
  verticalGroupBy?: string;
  purpose: string;
}

export const DESIRED_VIEWS: readonly DesiredViewSpec[] = [
  {
    name: "📥 Backlog",
    layout: "table",
    filter: "status:Backlog",
    visibleFields: ["Title", "Priority", "Repository", "Assignees"],
    purpose: "Triage work that has not started yet.",
  },
  {
    name: "🏃 Active Work",
    layout: "board",
    filter: "status:Todo,\"In Progress\",\"In Review\"",
    visibleFields: ["Title", "Priority", "Repository", "Assignees", "Status"],
    verticalGroupBy: "Status",
    purpose: "Run active work continuously across the standard Status columns.",
  },
  {
    name: "👤 My Work",
    layout: "table",
    filter: "assignee:@me -status:Done",
    visibleFields: ["Title", "Status", "Priority", "Repository", "Assignees"],
    purpose: "Show work assigned to the current viewer.",
  },
  {
    name: "🔍 Review Queue",
    layout: "table",
    filter: "status:\"In Review\"",
    visibleFields: ["Title", "Repository", "Linked pull requests", "Reviewers", "Assignees", "Priority"],
    purpose: "Surface work that is waiting for review.",
  },
  {
    name: "🧩 Workstream",
    layout: "table",
    visibleFields: ["Title", "Repository", "Status", "Priority", "Assignees"],
    groupBy: "Repository",
    purpose: "Organize frontend, backend, and LLM/RAG work by repository.",
  },
] as const;

interface RestProjectField {
  id?: number;
  node_id?: string;
  name?: string;
  data_type?: string;
}

interface ProjectViewsEnvelope {
  repositoryOwner?: {
    projectV2?: {
      id: string;
      number: number;
      title: string;
      url?: string | null;
      viewerCanUpdate?: boolean | null;
      views?: { nodes?: Array<ViewNode | null> | null } | null;
    } | null;
  } | null;
}

interface ProjectWorkflowsEnvelope {
  repositoryOwner?: {
    projectV2?: {
      workflows?: { nodes?: Array<WorkflowNode | null> | null } | null;
    } | null;
  } | null;
}

interface NamedNode {
  id?: string | null;
  name?: string | null;
}

interface ViewNode {
  id?: string | null;
  number?: number | null;
  name?: string | null;
  layout?: string | null;
  filter?: string | null;
  fields?: { nodes?: Array<NamedNode | null> | null } | null;
  groupByFields?: { nodes?: Array<NamedNode | null> | null } | null;
  verticalGroupByFields?: { nodes?: Array<NamedNode | null> | null } | null;
}

interface WorkflowNode {
  id?: string | null;
  number?: number | null;
  name?: string | null;
  enabled?: boolean | null;
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" ? value as UnknownRecord : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function namedNodes(connection: { nodes?: Array<NamedNode | null> | null } | null | undefined): string[] {
  return (connection?.nodes ?? []).flatMap((node) => node?.name ? [node.name] : []);
}

function normalizeIteration(raw: UnknownRecord): FoundationField["iteration"] {
  const configuration = object(raw.configuration);
  if (!configuration) return null;

  const normalize = (value: unknown): Array<{ id: string; title: string; startDate: string; duration: number }> =>
    (Array.isArray(value) ? value : []).flatMap((entry) => {
      const item = object(entry);
      if (!item) return [];
      const id = string(item.id);
      const title = string(item.title);
      const startDate = string(item.startDate);
      const duration = number(item.duration);
      return id && title && startDate && duration !== null ? [{ id, title, startDate, duration }] : [];
    });

  const upcoming = normalize(configuration.iterations);
  const completed = normalize(configuration.completedIterations);
  const today = new Date().toISOString().slice(0, 10);
  const current = upcoming.find((iteration) => {
    const start = new Date(`${iteration.startDate}T00:00:00Z`).getTime();
    const end = start + iteration.duration * 86_400_000;
    const now = new Date(`${today}T00:00:00Z`).getTime();
    return start <= now && now < end;
  }) ?? null;

  return {
    duration: number(configuration.duration),
    startDay: number(configuration.startDay),
    current,
    upcoming,
    completed,
  };
}

function normalizeFields(rawFields: unknown[], restFields: RestProjectField[]): FoundationField[] {
  const restByNodeId = new Map(restFields.flatMap((field) =>
    typeof field.node_id === "string" && typeof field.id === "number" ? [[field.node_id, field.id] as const] : []));

  return rawFields.flatMap((raw) => {
    const field = object(raw);
    if (!field) return [];
    const id = string(field.id);
    const name = string(field.name);
    const dataType = string(field.dataType);
    if (!id || !name || !dataType) return [];
    const options = Array.isArray(field.options)
      ? field.options.flatMap((rawOption) => {
          const option = object(rawOption);
          const optionName = option ? string(option.name) : null;
          return optionName ? [optionName] : [];
        })
      : [];
    return [{
      id,
      restId: restByNodeId.get(id) ?? null,
      name,
      dataType,
      options,
      iteration: dataType === "ITERATION" ? normalizeIteration(field) : null,
    }];
  });
}

function exactOptions(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((name) => actual.includes(name));
}

const VIEW_FIELD_NODE = `
  nodes {
    __typename
    ... on ProjectV2Field { id name }
    ... on ProjectV2SingleSelectField { id name }
    ... on ProjectV2IterationField { id name }
    ... on ProjectV2MultiSelectField { id name }
  }
`;

async function readViews(
  client: GitHubGraphQlClient,
  owner: string,
  projectNumber: number,
): Promise<{ project: NonNullable<NonNullable<ProjectViewsEnvelope["repositoryOwner"]>["projectV2"]>; views: FoundationView[] }> {
  const data = await client.request<ProjectViewsEnvelope>(
    `query($login: String!, $number: Int!) {
      repositoryOwner(login: $login) {
        ... on Organization {
          projectV2(number: $number) {
            id number title url viewerCanUpdate
            views(first: 100) {
              nodes {
                id number name layout filter
                fields(first: 30) { ${VIEW_FIELD_NODE} }
                groupByFields(first: 5) { ${VIEW_FIELD_NODE} }
                verticalGroupByFields(first: 5) { ${VIEW_FIELD_NODE} }
              }
            }
          }
        }
        ... on User {
          projectV2(number: $number) {
            id number title url viewerCanUpdate
            views(first: 100) {
              nodes {
                id number name layout filter
                fields(first: 30) { ${VIEW_FIELD_NODE} }
                groupByFields(first: 5) { ${VIEW_FIELD_NODE} }
                verticalGroupByFields(first: 5) { ${VIEW_FIELD_NODE} }
              }
            }
          }
        }
      }
    }`,
    { login: owner, number: projectNumber },
  );
  const project = data.repositoryOwner?.projectV2;
  if (!project) throw new Error(`GitHub Project #${projectNumber} was not found.`);

  const views = (project.views?.nodes ?? []).flatMap((view) =>
    view?.id && typeof view.number === "number" && view.name && view.layout
      ? [{
          id: view.id,
          number: view.number,
          name: view.name,
          layout: view.layout,
          filter: view.filter ?? null,
          visibleFields: namedNodes(view.fields),
          groupByFields: namedNodes(view.groupByFields),
          verticalGroupByFields: namedNodes(view.verticalGroupByFields),
        }]
      : []);
  return { project, views };
}

async function readWorkflows(
  client: GitHubGraphQlClient,
  owner: string,
  projectNumber: number,
): Promise<FoundationWorkflow[]> {
  const data = await client.request<ProjectWorkflowsEnvelope>(
    `query($login: String!, $number: Int!) {
      repositoryOwner(login: $login) {
        ... on Organization {
          projectV2(number: $number) {
            workflows(first: 100) { nodes { id number name enabled } }
          }
        }
        ... on User {
          projectV2(number: $number) {
            workflows(first: 100) { nodes { id number name enabled } }
          }
        }
      }
    }`,
    { login: owner, number: projectNumber },
  );
  const project = data.repositoryOwner?.projectV2;
  if (!project) throw new Error(`GitHub Project #${projectNumber} was not found.`);
  return (project.workflows?.nodes ?? []).flatMap((workflow) =>
    workflow?.id && typeof workflow.number === "number" && workflow.name && typeof workflow.enabled === "boolean"
      ? [{ id: workflow.id, number: workflow.number, name: workflow.name, enabled: workflow.enabled }]
      : []);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export async function inspectProjectOperatingFoundation(
  graphQl: GitHubGraphQlClient,
  rest: GitHubRestClient,
  owner = TARGET_PROJECT.owner,
  projectNumber = TARGET_PROJECT.number,
): Promise<ProjectFoundationInspection> {
  const [projectRaw, rawFields, restFieldResult, viewStateResult, workflowResult] = await Promise.all([
    getProject(graphQl, owner, projectNumber),
    listProjectFields(graphQl, owner, projectNumber),
    rest.request<RestProjectField[]>("GET", `/orgs/${encodeURIComponent(owner)}/projectsV2/${projectNumber}/fields?per_page=100`)
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) })),
    readViews(graphQl, owner, projectNumber)
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) })),
    readWorkflows(graphQl, owner, projectNumber)
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) })),
  ]);
  const project = object(projectRaw);
  const id = project ? string(project.id) : null;
  const title = project ? string(project.title) : null;
  const projectNumberValue = project ? number(project.number) : null;
  if (!id || !title || projectNumberValue === null) throw new Error("Project response was missing required metadata.");

  const restFields = restFieldResult.ok ? restFieldResult.value : [];
  const fields = normalizeFields(rawFields, restFields);
  const status = fields.find((field) => field.name === "Status") ?? null;
  const priority = fields.find((field) => field.name === "Priority") ?? null;
  const iteration = fields.find((field) => field.dataType === "ITERATION") ?? null;

  return {
    inspectedAt: new Date().toISOString(),
    project: {
      id,
      number: projectNumberValue,
      title,
      url: project ? string(project.url) : null,
      viewerCanUpdate: viewStateResult.ok && typeof viewStateResult.value.project.viewerCanUpdate === "boolean"
        ? viewStateResult.value.project.viewerCanUpdate
        : null,
    },
    fields,
    status: {
      compatible: status?.dataType === "SINGLE_SELECT" && exactOptions(status.options, REQUIRED_STATUS_OPTIONS),
      actualOptions: status?.options ?? [],
      requiredOptions: [...REQUIRED_STATUS_OPTIONS],
    },
    priority: {
      compatible: priority?.dataType === "SINGLE_SELECT" && exactOptions(priority.options, REQUIRED_PRIORITY_OPTIONS),
      preserved: true,
      actualOptions: priority?.options ?? [],
      requiredOptions: [...REQUIRED_PRIORITY_OPTIONS],
    },
    iteration: { exists: iteration !== null, field: iteration },
    views: viewStateResult.ok ? viewStateResult.value.views : [],
    workflows: workflowResult.ok ? workflowResult.value : [],
    access: {
      restFieldsReadable: restFieldResult.ok,
      viewsReadable: viewStateResult.ok,
      workflowsReadable: workflowResult.ok,
    },
    capabilityClassification: {
      iteration: "official-graphql-api",
      views: "official-rest-api-create-graphql-read",
      closeAndMergeToDone: "github-project-built-in-workflow",
      autoAdd: "github-project-built-in-workflow",
      readyForReviewToInReview: "repository-github-actions",
    },
    limitations: [
      "GitHub exposes workflow name/enabled state, but built-in workflow rule configuration still requires Project UI verification.",
      "Ready-for-review automation must be installed in each source repository; this repository only documents the least-privilege template.",
      "Existing views are never replaced automatically; incompatible same-name views are reported for manual review.",
      ...(!restFieldResult.ok ? [`REST Project fields were not readable: ${restFieldResult.error}`] : []),
      ...(!viewStateResult.ok ? [`Project views were not readable: ${viewStateResult.error}`] : []),
      ...(!workflowResult.ok ? [`Project workflow details were not readable: ${workflowResult.error}`] : []),
    ],
  };
}

function expectedGraphQlLayout(layout: DesiredViewSpec["layout"]): string {
  return layout === "board" ? "BOARD_LAYOUT" : "TABLE_LAYOUT";
}

export interface ViewPlan {
  spec: DesiredViewSpec;
  action: "create" | "skip-compatible" | "manual-review" | "blocked";
  reason: string;
  request: {
    name: string;
    layout: DesiredViewSpec["layout"];
    filter?: string;
    visible_fields: number[];
    group_by?: number[];
    vertical_group_by?: number[];
  } | null;
}

export function planProjectViews(inspection: ProjectFoundationInspection): ViewPlan[] {
  if (!inspection.access.viewsReadable || !inspection.access.restFieldsReadable) {
    return DESIRED_VIEWS.map((spec) => ({
      spec,
      action: "blocked" as const,
      reason: "view planning requires readable Project views and REST field IDs",
      request: null,
    }));
  }
  const fieldsByName = new Map(inspection.fields.map((field) => [field.name, field]));
  return DESIRED_VIEWS.map((spec) => {
    const existing = inspection.views.find((view) => view.name === spec.name);
    if (existing) {
      const reasons: string[] = [];
      if (existing.layout !== expectedGraphQlLayout(spec.layout)) reasons.push(`layout is ${existing.layout}`);
      if ((existing.filter ?? "") !== (spec.filter ?? "")) reasons.push(`filter is '${existing.filter ?? ""}'`);
      for (const fieldName of spec.visibleFields) {
        if (!existing.visibleFields.includes(fieldName)) reasons.push(`missing visible field '${fieldName}'`);
      }
      if (spec.groupBy && !existing.groupByFields.includes(spec.groupBy)) reasons.push(`not grouped by '${spec.groupBy}'`);
      if (spec.verticalGroupBy && !existing.verticalGroupByFields.includes(spec.verticalGroupBy)) {
        reasons.push(`board columns are not '${spec.verticalGroupBy}'`);
      }
      return reasons.length === 0
        ? { spec, action: "skip-compatible" as const, reason: "compatible view already exists", request: null }
        : { spec, action: "manual-review" as const, reason: reasons.join("; "), request: null };
    }

    const requiredNames = new Set([
      ...spec.visibleFields,
      ...(spec.groupBy ? [spec.groupBy] : []),
      ...(spec.verticalGroupBy ? [spec.verticalGroupBy] : []),
    ]);
    const missing = [...requiredNames].filter((name) => fieldsByName.get(name)?.restId === null || !fieldsByName.has(name));
    if (missing.length > 0) {
      return { spec, action: "blocked" as const, reason: `missing REST field IDs: ${missing.join(", ")}`, request: null };
    }
    const restId = (name: string): number => fieldsByName.get(name)!.restId!;
    return {
      spec,
      action: "create" as const,
      reason: "view is missing",
      request: {
        name: spec.name,
        layout: spec.layout,
        ...(spec.filter ? { filter: spec.filter } : {}),
        visible_fields: spec.visibleFields.map(restId),
        ...(spec.groupBy ? { group_by: [restId(spec.groupBy)] } : {}),
        ...(spec.verticalGroupBy ? { vertical_group_by: [restId(spec.verticalGroupBy)] } : {}),
      },
    };
  });
}

function assertTargetProject(inspection: ProjectFoundationInspection): void {
  if (inspection.project.id !== TARGET_PROJECT.id
      || inspection.project.number !== TARGET_PROJECT.number
      || inspection.project.title !== TARGET_PROJECT.title) {
    throw new Error("TARGET_PROJECT_MISMATCH: Refusing to configure a Project other than gyuniverse-hq/2 Bid Change Validator · WBS.");
  }
}

export async function applyProjectOperatingFoundation(
  graphQl: GitHubGraphQlClient,
  rest: GitHubRestClient,
  config: AppConfig,
): Promise<{ before: ProjectFoundationInspection; actions: string[]; after: ProjectFoundationInspection }> {
  assertOwnerAllowed(config, TARGET_PROJECT.owner);
  const before = await inspectProjectOperatingFoundation(graphQl, rest);
  assertTargetProject(before);
  assertProjectAllowed(config, before.project.id);
  assertProjectWriteAllowed(config, before.project.id);
  if (!before.priority.compatible) throw new Error("PRIORITY_INCOMPATIBLE: Existing Priority must be P0/P1/P2/P3 and is never recreated.");
  if (!before.status.compatible) throw new Error("STATUS_INCOMPATIBLE: Existing Status must be Backlog/Todo/In Progress/In Review/Done.");
  if (!before.access.viewsReadable || !before.access.restFieldsReadable) {
    throw new Error("PROJECT_VIEW_ACCESS_REQUIRED: Refusing to apply without readable views and REST field IDs.");
  }

  const actions: string[] = ["preserved existing Priority field and options"];
  const current = before;
  actions.push(current.iteration.exists
    ? "preserved existing Iteration field without using it"
    : "left Iteration absent for the no-sprint operating model");

  const viewPlans = planProjectViews(current);
  for (const plan of viewPlans) {
    if (plan.action !== "create" || !plan.request) continue;
    await rest.request(
      "POST",
      `/orgs/${encodeURIComponent(TARGET_PROJECT.owner)}/projectsV2/${TARGET_PROJECT.number}/views`,
      plan.request,
    );
    actions.push(`created view ${plan.spec.name}`);
  }

  const after = await inspectProjectOperatingFoundation(graphQl, rest);
  for (const action of actions) {
    if (!action.startsWith("created view ")) continue;
    const name = action.slice("created view ".length);
    const verification = planProjectViews(after).find((plan) => plan.spec.name === name);
    if (!verification || verification.action !== "skip-compatible") {
      throw new Error(`MUTATION_VERIFICATION_FAILED: View '${name}' was not compatible after creation.`);
    }
  }
  return { before, actions, after };
}
