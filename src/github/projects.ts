import { GitHubGraphQlClient } from "./graphql-client.js";

interface OwnerProjectConnection {
  projectsV2?: { nodes?: unknown[] | null } | null;
  projectV2?: unknown | null;
}

interface OwnerEnvelope {
  repositoryOwner?: OwnerProjectConnection | null;
}

function ownerFrom(data: OwnerEnvelope): OwnerProjectConnection {
  const owner = data.repositoryOwner;
  if (!owner) throw new Error("GitHub owner was not found or is not accessible.");
  return owner;
}

const PROJECT_CORE = `
  id
  number
  title
  shortDescription
  readme
  url
  closed
  public
  createdAt
  updatedAt
`;

export async function listProjects(
  client: GitHubGraphQlClient,
  owner: string,
  first = 20,
): Promise<unknown[]> {
  const data = await client.request<OwnerEnvelope>(
    `query($login: String!, $first: Int!) {
      repositoryOwner(login: $login) {
        ... on Organization { projectsV2(first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PROJECT_CORE} } } }
        ... on User { projectsV2(first: $first, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${PROJECT_CORE} } } }
      }
    }`,
    { login: owner, first },
  );
  return ownerFrom(data).projectsV2?.nodes ?? [];
}

export async function getProject(
  client: GitHubGraphQlClient,
  owner: string,
  number: number,
): Promise<unknown> {
  const data = await client.request<OwnerEnvelope>(
    `query($login: String!, $number: Int!) {
      repositoryOwner(login: $login) {
        ... on Organization { projectV2(number: $number) { ${PROJECT_CORE} } }
        ... on User { projectV2(number: $number) { ${PROJECT_CORE} } }
      }
    }`,
    { login: owner, number },
  );
  const project = ownerFrom(data).projectV2;
  if (!project) throw new Error(`GitHub Project #${number} was not found.`);
  return project;
}

const FIELD_NODES = `
  nodes {
    __typename
    ... on ProjectV2Field { id name dataType }
    ... on ProjectV2SingleSelectField { id name dataType options { id name } }
    ... on ProjectV2IterationField {
      id name dataType
      configuration {
        duration
        startDay
        iterations { id title startDate duration }
        completedIterations { id title startDate duration }
      }
    }
    ... on ProjectV2MultiSelectField { id name dataType options: multiSelectOptions { id name } }
  }
`;

export async function listProjectFields(
  client: GitHubGraphQlClient,
  owner: string,
  number: number,
): Promise<unknown[]> {
  const data = await client.request<OwnerEnvelope>(
    `query($login: String!, $number: Int!) {
      repositoryOwner(login: $login) {
        ... on Organization { projectV2(number: $number) { fields(first: 100) { ${FIELD_NODES} } } }
        ... on User { projectV2(number: $number) { fields(first: 100) { ${FIELD_NODES} } } }
      }
    }`,
    { login: owner, number },
  );
  const project = ownerFrom(data).projectV2 as { fields?: { nodes?: unknown[] | null } } | null;
  if (!project) throw new Error(`GitHub Project #${number} was not found.`);
  return project.fields?.nodes ?? [];
}

const ITEM_NODE = `
  id
  type
  isArchived
  content {
    __typename
    ... on Issue {
      id number title url state
      repository { nameWithOwner }
      assignees(first: 20) { nodes { login } }
    }
    ... on PullRequest {
      id number title url state merged
      repository { nameWithOwner }
      assignees(first: 20) { nodes { login } }
    }
    ... on DraftIssue { id title body }
  }
  fieldValues(first: 50) {
    nodes {
      __typename
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { id name } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2Field { id name } } }
      ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { id name } } }
      ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id name } } }
      ... on ProjectV2ItemFieldMultiSelectValue { options { id name } field { ... on ProjectV2MultiSelectField { id name } } }
      ... on ProjectV2ItemFieldIterationValue { title iterationId startDate duration field { ... on ProjectV2IterationField { id name } } }
      ... on ProjectV2ItemFieldUserValue { users(first: 20) { nodes { login } } field { ... on ProjectV2Field { id name } } }
      ... on ProjectV2ItemFieldLabelValue { labels(first: 20) { nodes { name } } field { ... on ProjectV2Field { id name } } }
      ... on ProjectV2ItemFieldMilestoneValue { milestone { title } field { ... on ProjectV2Field { id name } } }
      ... on ProjectV2ItemFieldRepositoryValue { repository { nameWithOwner } field { ... on ProjectV2Field { id name } } }
    }
  }
`;

export const MAX_PROJECT_ITEMS = 500;

export interface ProjectItemsResult {
  items: unknown[];
  hasMoreItems: boolean;
  pagesFetched: number;
  requestedLimit: number;
}

/**
 * Collect up to a caller-defined total of 500 Project items using GitHub's
 * per-request cap of 100. Distinguishes a complete result from a truncated one.
 * Fail closed on malformed cursors, non-advancing pages, and duplicate items.
 */
export async function listProjectItemsWithCoverage(
  client: GitHubGraphQlClient,
  owner: string,
  number: number,
  limit = 50,
): Promise<ProjectItemsResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PROJECT_ITEMS) {
    throw new Error("PROJECT_ITEMS_LIMIT_INVALID: limit must be between 1 and 500.");
  }

  const items: unknown[] = [];
  const seenIds = new Set<string>();
  let cursor: string | null = null;
  let pagesFetched = 0;
  let hasMoreItems = false;

  while (items.length < limit) {
    const pageSize = Math.min(100, limit - items.length);
    const data: OwnerEnvelope = await client.request<OwnerEnvelope>(
      `query($login: String!, $number: Int!, $pageSize: Int!, $after: String) {
        repositoryOwner(login: $login) {
          ... on Organization { projectV2(number: $number) { items(first: $pageSize, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ITEM_NODE} } } } }
          ... on User { projectV2(number: $number) { items(first: $pageSize, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${ITEM_NODE} } } } }
        }
      }`,
      { login: owner, number, pageSize, after: cursor },
    );
    const project = ownerFrom(data).projectV2 as {
      items?: {
        nodes?: unknown[] | null;
        pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
      } | null;
    } | null;
    if (!project) throw new Error(`GitHub Project #${number} was not found.`);
    const page = project.items;
    if (!page) throw new Error("PROJECT_ITEMS_MISSING: GraphQL returned no items connection.");
    pagesFetched += 1;

    const nodes = page.nodes ?? [];
    if (nodes.length > pageSize) throw new Error("PROJECT_ITEMS_OVERSIZED_PAGE: Unexpected page size.");
    for (const node of nodes) {
      if (!node || typeof node !== "object" || typeof (node as { id?: unknown }).id !== "string") {
        throw new Error("PROJECT_ITEMS_INVALID_NODE: Item ID must be present.");
      }
      const id = (node as { id: string }).id;
      if (seenIds.has(id)) throw new Error("PROJECT_ITEMS_DUPLICATE: Pagination returned a duplicate item.");
      seenIds.add(id);
      items.push(node);
    }
    hasMoreItems = page.pageInfo?.hasNextPage === true;
    if (!hasMoreItems) break;
    const nextCursor = page.pageInfo?.endCursor;
    if (typeof nextCursor !== "string" || !nextCursor || nextCursor === cursor || nodes.length === 0) {
      throw new Error("PROJECT_ITEMS_CURSOR_INVALID: Cursor did not advance.");
    }
    cursor = nextCursor;
  }

  return { items, hasMoreItems, pagesFetched, requestedLimit: limit };
}

export async function listProjectItems(
  client: GitHubGraphQlClient,
  owner: string,
  number: number,
  first = 50,
): Promise<unknown[]> {
  return (await listProjectItemsWithCoverage(client, owner, number, first)).items;
}

interface FieldValueNode {
  __typename?: string;
  name?: string | null;
  title?: string | null;
  text?: string | null;
  number?: number | null;
  date?: string | null;
  optionId?: string | null;
  iterationId?: string | null;
  options?: Array<{ id?: string | null; name?: string | null }> | null;
  users?: { nodes?: Array<{ login?: string | null }> | null } | null;
  labels?: { nodes?: Array<{ name?: string | null }> | null } | null;
  milestone?: { title?: string | null } | null;
  repository?: { nameWithOwner?: string | null } | null;
  field?: { id?: string | null; name?: string | null } | null;
}

interface ProjectItem {
  id?: string;
  type?: string;
  isArchived?: boolean;
  content?: {
    __typename?: string;
    id?: string;
    number?: number;
    title?: string;
    url?: string;
    state?: string;
    merged?: boolean;
    repository?: { nameWithOwner?: string };
    assignees?: { nodes?: Array<{ login?: string }> };
  } | null;
  fieldValues?: { nodes?: FieldValueNode[] | null } | null;
}

function normalizeFieldValue(value: FieldValueNode): unknown {
  switch (value.__typename) {
    case "ProjectV2ItemFieldSingleSelectValue": return value.name ?? null;
    case "ProjectV2ItemFieldMultiSelectValue": return value.options?.map((option) => option.name).filter(Boolean) ?? [];
    case "ProjectV2ItemFieldIterationValue": return value.title ?? null;
    case "ProjectV2ItemFieldTextValue": return value.text ?? null;
    case "ProjectV2ItemFieldNumberValue": return value.number ?? null;
    case "ProjectV2ItemFieldDateValue": return value.date ?? null;
    case "ProjectV2ItemFieldUserValue": return value.users?.nodes?.map((node) => node.login).filter(Boolean) ?? [];
    case "ProjectV2ItemFieldLabelValue": return value.labels?.nodes?.map((node) => node.name).filter(Boolean) ?? [];
    case "ProjectV2ItemFieldMilestoneValue": return value.milestone?.title ?? null;
    case "ProjectV2ItemFieldRepositoryValue": return value.repository?.nameWithOwner ?? null;
    default: return null;
  }
}

export async function getProjectSnapshot(
  client: GitHubGraphQlClient,
  owner: string,
  number: number,
  first = 100,
): Promise<unknown> {
  const [project, fields, paginated] = await Promise.all([
    getProject(client, owner, number),
    listProjectFields(client, owner, number),
    listProjectItemsWithCoverage(client, owner, number, first),
  ]);

  const items = (paginated.items as ProjectItem[]).map((item) => {
    const fieldValues: Record<string, unknown> = {};
    for (const value of item.fieldValues?.nodes ?? []) {
      const fieldName = value.field?.name;
      if (fieldName) fieldValues[fieldName] = normalizeFieldValue(value);
    }
    const content = item.content ?? {};
    return {
      itemId: item.id,
      itemType: item.type,
      archived: item.isArchived ?? false,
      contentType: content.__typename ?? null,
      contentId: content.id ?? null,
      repository: content.repository?.nameWithOwner ?? null,
      number: content.number ?? null,
      title: content.title ?? null,
      url: content.url ?? null,
      state: content.state ?? null,
      merged: content.merged ?? null,
      assignees: content.assignees?.nodes?.map((node) => node.login).filter(Boolean) ?? [],
      fields: fieldValues,
    };
  });

  return {
    snapshotAt: new Date().toISOString(),
    owner,
    project,
    fields,
    itemCount: items.length,
    hasMoreItems: paginated.hasMoreItems,
    pagesFetched: paginated.pagesFetched,
    requestedLimit: paginated.requestedLimit,
    items,
  };
}

export async function addItemToProject(
  client: GitHubGraphQlClient,
  projectId: string,
  contentId: string,
): Promise<unknown> {
  const data = await client.request<{ addProjectV2ItemById: { item: unknown } }>(
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) { item { id type } }
    }`,
    { projectId, contentId },
  );
  return data.addProjectV2ItemById.item;
}

export type ProjectFieldValue = {
  text?: string;
  number?: number;
  date?: string;
  singleSelectOptionId?: string;
  multiSelectOptionIds?: string[];
  iterationId?: string;
};

export async function updateProjectItemField(
  client: GitHubGraphQlClient,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: ProjectFieldValue,
): Promise<unknown> {
  const data = await client.request<{ updateProjectV2ItemFieldValue: { projectV2Item: unknown } }>(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: $value
      }) { projectV2Item { id } }
    }`,
    { projectId, itemId, fieldId, value },
  );
  return data.updateProjectV2ItemFieldValue.projectV2Item;
}
