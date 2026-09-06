import { GitHubGraphQlClient } from "../github/graphql-client.js";

export interface AssignableUser {
  id: string;
  login: string;
}

interface AssignableContext {
  itemId: string;
  projectId: string;
  projectNumber: number | null;
  projectTitle: string | null;
  assignableId: string;
  contentType: "Issue" | "PullRequest";
  assignees: AssignableUser[];
}

interface ItemEnvelope {
  node?: {
    __typename?: string | null;
    id?: string | null;
    project?: {
      id?: string | null;
      number?: number | null;
      title?: string | null;
    } | null;
    content?: {
      __typename?: string | null;
      id?: string | null;
      assignees?: {
        nodes?: Array<{ id?: string | null; login?: string | null } | null> | null;
      } | null;
    } | null;
  } | null;
}

interface UserEnvelope {
  user?: { id?: string | null; login?: string | null } | null;
}

interface MutationEnvelope {
  addAssigneesToAssignable?: {
    assignable?: { id?: string | null } | null;
  } | null;
}

export interface AssignWorkItemResult {
  changed: boolean;
  verified: boolean;
  project: {
    id: string;
    number: number | null;
    title: string | null;
  };
  itemId: string;
  content: {
    id: string;
    type: "Issue" | "PullRequest";
  };
  requestedAssignee: AssignableUser;
  before: AssignableUser[];
  after: AssignableUser[];
  mutationSkippedReason: "already_assigned" | null;
}

function normalizeAssignees(
  nodes: Array<{ id?: string | null; login?: string | null } | null> | null | undefined,
): AssignableUser[] {
  return (nodes ?? []).flatMap((node) =>
    node && typeof node.id === "string" && node.id && typeof node.login === "string" && node.login
      ? [{ id: node.id, login: node.login }]
      : [],
  );
}

async function getAssignableContext(
  client: GitHubGraphQlClient,
  itemId: string,
): Promise<AssignableContext> {
  const data = await client.request<ItemEnvelope>(
    `query($itemId: ID!) {
      node(id: $itemId) {
        __typename
        ... on ProjectV2Item {
          id
          project { id number title }
          content {
            __typename
            ... on Issue {
              id
              assignees(first: 100) { nodes { id login } }
            }
            ... on PullRequest {
              id
              assignees(first: 100) { nodes { id login } }
            }
          }
        }
      }
    }`,
    { itemId },
  );

  const item = data.node;
  if (!item || item.__typename !== "ProjectV2Item" || typeof item.id !== "string") {
    throw new Error(`PROJECT_ITEM_NOT_FOUND: '${itemId}' is not an accessible ProjectV2 item.`);
  }

  const projectId = item.project?.id;
  if (typeof projectId !== "string" || !projectId) {
    throw new Error(`PROJECT_ITEM_INVALID: Project item '${itemId}' does not expose a valid parent Project ID.`);
  }

  const content = item.content;
  if (
    !content ||
    (content.__typename !== "Issue" && content.__typename !== "PullRequest") ||
    typeof content.id !== "string" ||
    !content.id
  ) {
    throw new Error(
      `ASSIGNABLE_CONTENT_REQUIRED: Project item '${itemId}' must contain an Issue or Pull Request.`,
    );
  }

  return {
    itemId: item.id,
    projectId,
    projectNumber: typeof item.project?.number === "number" ? item.project.number : null,
    projectTitle: typeof item.project?.title === "string" ? item.project.title : null,
    assignableId: content.id,
    contentType: content.__typename,
    assignees: normalizeAssignees(content.assignees?.nodes),
  };
}

async function resolveUser(client: GitHubGraphQlClient, login: string): Promise<AssignableUser> {
  const data = await client.request<UserEnvelope>(
    `query($login: String!) { user(login: $login) { id login } }`,
    { login },
  );
  const user = data.user;
  if (!user || typeof user.id !== "string" || !user.id || typeof user.login !== "string" || !user.login) {
    throw new Error(`GITHUB_USER_NOT_FOUND: GitHub user '${login}' was not found or is not accessible.`);
  }
  return { id: user.id, login: user.login };
}

function assertItemInProject(context: AssignableContext, expectedProjectId: string): void {
  if (context.projectId !== expectedProjectId) {
    throw new Error(
      `PROJECT_ITEM_PROJECT_MISMATCH: Project item '${context.itemId}' belongs to '${context.projectId}', not '${expectedProjectId}'.`,
    );
  }
}

function hasLogin(assignees: AssignableUser[], login: string): boolean {
  const normalized = login.toLowerCase();
  return assignees.some((assignee) => assignee.login.toLowerCase() === normalized);
}

export async function assignProjectWorkItem(
  client: GitHubGraphQlClient,
  input: { projectId: string; itemId: string; assigneeLogin: string },
): Promise<AssignWorkItemResult> {
  const requestedAssignee = await resolveUser(client, input.assigneeLogin);
  const beforeContext = await getAssignableContext(client, input.itemId);
  assertItemInProject(beforeContext, input.projectId);

  if (hasLogin(beforeContext.assignees, requestedAssignee.login)) {
    return {
      changed: false,
      verified: true,
      project: {
        id: beforeContext.projectId,
        number: beforeContext.projectNumber,
        title: beforeContext.projectTitle,
      },
      itemId: beforeContext.itemId,
      content: { id: beforeContext.assignableId, type: beforeContext.contentType },
      requestedAssignee,
      before: beforeContext.assignees,
      after: beforeContext.assignees,
      mutationSkippedReason: "already_assigned",
    };
  }

  await client.request<MutationEnvelope>(
    `mutation($assignableId: ID!, $assigneeIds: [ID!]!) {
      addAssigneesToAssignable(input: { assignableId: $assignableId, assigneeIds: $assigneeIds }) {
        assignable { id }
      }
    }`,
    { assignableId: beforeContext.assignableId, assigneeIds: [requestedAssignee.id] },
  );

  const afterContext = await getAssignableContext(client, input.itemId);
  assertItemInProject(afterContext, input.projectId);
  if (!hasLogin(afterContext.assignees, requestedAssignee.login)) {
    throw new Error(
      `MUTATION_VERIFICATION_FAILED: '${requestedAssignee.login}' is not assigned after mutation.`,
    );
  }

  return {
    changed: true,
    verified: true,
    project: {
      id: afterContext.projectId,
      number: afterContext.projectNumber,
      title: afterContext.projectTitle ?? beforeContext.projectTitle,
    },
    itemId: afterContext.itemId,
    content: { id: afterContext.assignableId, type: afterContext.contentType },
    requestedAssignee,
    before: beforeContext.assignees,
    after: afterContext.assignees,
    mutationSkippedReason: null,
  };
}
