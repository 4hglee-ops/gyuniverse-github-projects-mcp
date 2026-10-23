import { z } from "zod";
import type { GitHubGraphQlClient } from "./graphql-client.js";
import type { GitHubRestClient } from "./rest-client.js";

export const viewLayout = z.enum(["table", "board", "roadmap"]);
export type ViewLayout = z.infer<typeof viewLayout>;
export const graphLayout = (layout: ViewLayout) => ({ table: "TABLE_LAYOUT", board: "BOARD_LAYOUT", roadmap: "ROADMAP_LAYOUT" })[layout];
const named = z.object({ id: z.string().min(1), name: z.string().min(1) });
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const connection = <T extends z.ZodType>(node: T) => z.object({ nodes: z.array(node), pageInfo });
const fieldNode = named.extend({ dataType: z.string(), options: z.array(z.object({ name: z.string() })).optional() });
const viewNode = z.object({
  id: z.string().min(1), number: z.number().int().positive(), name: z.string(),
  layout: z.enum(["TABLE_LAYOUT", "BOARD_LAYOUT", "ROADMAP_LAYOUT"]), filter: z.string().nullable(),
  fields: connection(named), groupByFields: connection(named), verticalGroupByFields: connection(named),
  sortByFields: connection(z.object({ field: named, direction: z.enum(["ASC", "DESC"]) })),
});
export interface ProjectView {
  id: string; number: number; name: string; layout: string; filter: string | null;
  visibleFields: string[]; visibleFieldIds: string[];
  groupByFields: string[]; verticalGroupByFields: string[];
  sortBy: Array<{ field: string; direction: "asc" | "desc" }>;
}
export interface ViewField { id: string; restId: number | null; name: string; dataType: string; options: string[] }
export interface ViewState {
  project: { id: string; number: number; title: string; url: string | null; viewerCanUpdate: boolean; ownerType: "Organization" | "User" };
  views: ProjectView[];
}
export interface RestViewCreate {
  name: string; layout: ViewLayout; filter?: string; visible_fields?: number[];
  group_by?: number[]; vertical_group_by?: number[]; sort_by?: Array<[number, "asc" | "desc"]>;
}
export const viewChangesSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(), filter: z.string().max(1024).optional(),
  layout: viewLayout.optional(), visibleFieldIds: z.array(z.string().min(1).max(256)).max(100).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "Provide a supported View change.");
export type ViewChanges = z.infer<typeof viewChangesSchema>;

const fieldFragment = `... on ProjectV2Field { id name } ... on ProjectV2SingleSelectField { id name }
  ... on ProjectV2IterationField { id name } ... on ProjectV2MultiSelectField { id name }`;
const namedConnection = `nodes { ${fieldFragment} } pageInfo { hasNextPage endCursor }`;
const viewSelection = `id number name layout filter
  fields(first: 100) { ${namedConnection} }
  groupByFields(first: 100) { ${namedConnection} }
  verticalGroupByFields(first: 100) { ${namedConnection} }
  sortByFields(first: 100) { nodes { direction field { ${fieldFragment} } } pageInfo { hasNextPage endCursor } }`;

/** Upstream bodies can contain private data. Expose only a bounded failure code. */
async function upstream<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("VIEW_UPSTREAM_TIMEOUT")), 10_000);
    })]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "VIEW_UPSTREAM_TIMEOUT") throw new Error("VIEW_UPSTREAM_TIMEOUT: Request outcome is unknown; inspect state before any retry.");
    const status = /\((401|403|404|422|429|5\d\d)\)/.exec(message)?.[1];
    throw new Error(status ? `VIEW_UPSTREAM_${status}: GitHub View request failed.` : "VIEW_UPSTREAM_FAILED: GitHub View request failed.");
  } finally { if (timer) clearTimeout(timer); }
}

export async function readProjectViews(client: GitHubGraphQlClient, owner: string, number: number): Promise<ViewState> {
  const views: ProjectView[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let after: string | null = null;
  let project: ViewState["project"] | undefined;
  for (let page = 0; page < 10; page++) {
    const selection = `id number title url viewerCanUpdate views(first: 100, after: $after) { nodes { ${viewSelection} } pageInfo { hasNextPage endCursor } }`;
    const raw = await upstream(() => client.request(`query ProjectViews($login: String!, $number: Int!, $after: String) {
      repositoryOwner(login: $login) { __typename ... on Organization { projectV2(number: $number) { ${selection} } }
        ... on User { projectV2(number: $number) { ${selection} } } }
    }`, { login: owner, number, after }));
    const parsed = z.object({ repositoryOwner: z.object({ __typename: z.enum(["Organization", "User"]), projectV2: z.object({
      id: z.string().min(1), number: z.number().int().positive(), title: z.string(), url: z.string().nullable(),
      viewerCanUpdate: z.boolean(), views: connection(viewNode),
    }) }) }).safeParse(raw);
    if (!parsed.success) throw new Error("VIEW_RESPONSE_INVALID: Unable to read complete Project views.");
    const { projectV2: p, __typename: ownerType } = parsed.data.repositoryOwner;
    if (p.number !== number || (project && project.id !== p.id) || p.views.nodes.length > 100) throw new Error("VIEW_RESPONSE_INVALID: Project identity or page changed.");
    project = { id: p.id, number: p.number, title: p.title, url: p.url, viewerCanUpdate: p.viewerCanUpdate, ownerType };
    for (const v of p.views.nodes) {
      if (ids.has(v.id) || [v.fields, v.groupByFields, v.verticalGroupByFields, v.sortByFields].some((c) => c.pageInfo.hasNextPage)) {
        throw new Error("VIEW_RESPONSE_INCOMPLETE: Duplicate View or truncated configuration.");
      }
      ids.add(v.id);
      views.push({ id: v.id, number: v.number, name: v.name, layout: v.layout, filter: v.filter,
        visibleFields: v.fields.nodes.map((f) => f.name), visibleFieldIds: v.fields.nodes.map((f) => f.id),
        groupByFields: v.groupByFields.nodes.map((f) => f.name), verticalGroupByFields: v.verticalGroupByFields.nodes.map((f) => f.name),
        sortBy: v.sortByFields.nodes.map((s) => ({ field: s.field.name, direction: s.direction === "ASC" ? "asc" : "desc" })),
      });
    }
    if (!p.views.pageInfo.hasNextPage) return { project, views };
    const next = p.views.pageInfo.endCursor;
    if (!next || cursors.has(next) || !p.views.nodes.length) throw new Error("VIEW_CURSOR_INVALID: View cursor did not advance.");
    cursors.add(next); after = next;
  }
  throw new Error("VIEW_RESPONSE_INCOMPLETE: View page limit exceeded.");
}

export function restFieldIds(fields: readonly { node_id?: string; id?: number }[]): Map<string, number> {
  const ids = new Map<string, number>(), numeric = new Set<number>();
  for (const f of fields) {
    if (!f.node_id || !Number.isSafeInteger(f.id) || f.id! <= 0 || ids.has(f.node_id) || numeric.has(f.id!)) {
      throw new Error("VIEW_FIELD_IDS_INVALID: REST fields must have unique node and integer IDs.");
    }
    ids.set(f.node_id, f.id!); numeric.add(f.id!);
  }
  return ids;
}

export async function readViewFields(client: GitHubGraphQlClient, owner: string, number: number): Promise<ViewField[]> {
  const result: ViewField[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let after: string | null = null;
  const fields = `fields(first: 100, after: $after) { nodes {
    ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType options { name } }
    ... on ProjectV2IterationField { id name dataType } ... on ProjectV2MultiSelectField { id name dataType options: multiSelectOptions { name } }
  } pageInfo { hasNextPage endCursor } }`;
  for (let page = 0; page < 10; page++) {
    const raw = await upstream(() => client.request(`query ViewFields($login: String!, $number: Int!, $after: String) {
      repositoryOwner(login: $login) { ... on Organization { projectV2(number: $number) { ${fields} } }
      ... on User { projectV2(number: $number) { ${fields} } } }
    }`, { login: owner, number, after }));
    const parsed = z.object({ repositoryOwner: z.object({ projectV2: z.object({ fields: connection(fieldNode) }) }) }).safeParse(raw);
    if (!parsed.success) throw new Error("VIEW_FIELDS_INVALID: Complete field metadata is required.");
    const c = parsed.data.repositoryOwner.projectV2.fields;
    for (const f of c.nodes) {
      if (ids.has(f.id)) throw new Error("VIEW_FIELDS_INVALID: Duplicate field ID.");
      ids.add(f.id); result.push({ ...f, restId: null, options: f.options?.map((o) => o.name) ?? [] });
    }
    if (!c.pageInfo.hasNextPage) return result;
    const next = c.pageInfo.endCursor;
    if (!next || cursors.has(next) || !c.nodes.length) throw new Error("VIEW_CURSOR_INVALID: Field cursor did not advance.");
    cursors.add(next); after = next;
  }
  throw new Error("VIEW_FIELDS_INCOMPLETE: Field page limit exceeded.");
}

export async function readRestViewFieldIds(rest: GitHubRestClient, owner: string, number: number): Promise<Map<string, number>> {
  const raw = await upstream(() => rest.request<unknown>("GET", `/orgs/${encodeURIComponent(owner)}/projectsV2/${number}/fields?per_page=100`));
  const parsed = z.array(z.object({ node_id: z.string().min(1), id: z.number().int().positive() })).safeParse(raw);
  if (!parsed.success) throw new Error("VIEW_FIELD_IDS_INVALID: Invalid REST field response.");
  // The existing REST client does not expose Link headers. Never treat a full page as complete.
  if (parsed.data.length >= 100) throw new Error("VIEW_FIELDS_INCOMPLETE: REST field pagination requires manual review.");
  return restFieldIds(parsed.data);
}

export async function createProjectView(rest: GitHubRestClient, owner: string, number: number, body: RestViewCreate): Promise<string> {
  const raw = await upstream(() => rest.request<unknown>("POST", `/orgs/${encodeURIComponent(owner)}/projectsV2/${number}/views`, body));
  const parsed = z.object({ value: z.object({ node_id: z.string().min(1) }) }).safeParse(raw);
  if (!parsed.success) throw new Error("VIEW_CREATE_UNCERTAIN: Re-read views before making a new plan.");
  return parsed.data.value.node_id;
}

export async function updateProjectView(client: GitHubGraphQlClient, viewId: string, changes: ViewChanges): Promise<string> {
  const input = viewChangesSchema.parse(changes);
  const { visibleFieldIds, layout, ...other } = input;
  const raw = await upstream(() => client.request(`mutation UpdateProjectView($input: UpdateProjectV2ViewInput!) {
    updateProjectV2View(input: $input) { projectV2View { id } }
  }`, { input: { viewId, ...other, ...(layout ? { layout: graphLayout(layout) } : {}),
    ...(visibleFieldIds ? { configuration: { visibleFieldIds } } : {}) } }));
  const parsed = z.object({ updateProjectV2View: z.object({ projectV2View: z.object({ id: z.literal(viewId) }) }) }).safeParse(raw);
  if (!parsed.success) throw new Error("VIEW_UPDATE_UNCERTAIN: Re-read views before making a new plan.");
  return parsed.data.updateProjectV2View.projectV2View.id;
}
