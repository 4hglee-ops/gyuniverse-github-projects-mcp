/**
 * Provider-qualified resource and work-item references.
 *
 * These describe *where* a resource lives; they never grant access.
 * The provider must still enforce its authenticated principal, allowlists,
 * resource membership and capability policy before performing a read/write.
 */
export type ProviderId = "github_projects" | "jira";

export interface GitHubProjectResourceRef {
  readonly provider: "github_projects";
  readonly kind: "github_project_v2";
  readonly owner: string;
  readonly projectNumber: number;
}

export interface JiraProjectResourceRef {
  readonly provider: "jira";
  readonly kind: "jira_project";
  /** Atlassian cloudId: identifies the site, not the user's display URL. */
  readonly cloudId: string;
  /** Stable Jira project ID. The changeable projectKey is not an ACL key. */
  readonly projectId: string;
  readonly projectKey?: string;
}

export type ResourceRef = GitHubProjectResourceRef | JiraProjectResourceRef;

export interface GitHubWorkItemRef {
  readonly provider: "github_projects";
  readonly resource: GitHubProjectResourceRef;
  /** ProjectV2Item GraphQL node ID (not repository issue number). */
  readonly itemId: string;
}

export interface JiraWorkItemRef {
  readonly provider: "jira";
  readonly resource: JiraProjectResourceRef;
  /** Stable Jira issue ID; issueKey may change. */
  readonly issueId: string;
  readonly issueKey?: string;
}

export type WorkItemRef = GitHubWorkItemRef | JiraWorkItemRef;

function bounded(value: string, name: string, pattern: RegExp, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value !== value.trim() || !pattern.test(value)) {
    throw new Error("RESOURCE_REF_INVALID: Invalid " + name + ".");
  }
  return value;
}

/** Canonicalizes a GitHub owner without bypassing ProjectService authorization. */
export function githubProjectRef(owner: string, projectNumber: number): GitHubProjectResourceRef {
  const normalizedOwner = bounded(owner, "GitHub owner", /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/, 100).toLowerCase();
  if (!Number.isSafeInteger(projectNumber) || projectNumber < 1) {
    throw new Error("RESOURCE_REF_INVALID: GitHub project number must be a positive safe integer.");
  }
  return { provider: "github_projects", kind: "github_project_v2", owner: normalizedOwner, projectNumber };
}

/**
 * A Jira site URL + project key must be discovered/resolved to cloudId +
 * projectId before being stored as a durable permission target.
 */
export function jiraProjectRef(cloudId: string, projectId: string, projectKey?: string): JiraProjectResourceRef {
  const ref: JiraProjectResourceRef = {
    provider: "jira",
    kind: "jira_project",
    cloudId: bounded(cloudId, "Jira cloudId", /^[A-Za-z0-9-]+$/, 128).toLowerCase(),
    projectId: bounded(projectId, "Jira project ID", /^[0-9]+$/, 64),
  };
  if (projectKey === undefined) return ref;
  return {
    ...ref,
    projectKey: bounded(projectKey, "Jira project key", /^[A-Za-z][A-Za-z0-9_]*$/, 128).toUpperCase(),
  };
}

/** Runtime validation also prevents misrouted or forged provider fields. */
export function normalizeResourceRef(ref: ResourceRef): ResourceRef {
  if (!ref || typeof ref !== "object") throw new Error("RESOURCE_REF_INVALID: Resource must be an object.");
  if (ref.provider === "github_projects" && ref.kind === "github_project_v2") {
    return githubProjectRef(ref.owner, ref.projectNumber);
  }
  if (ref.provider === "jira" && ref.kind === "jira_project") {
    return jiraProjectRef(ref.cloudId, ref.projectId, ref.projectKey);
  }
  throw new Error("RESOURCE_REF_INVALID: Unsupported resource provider or kind.");
}

/**
 * Canonical external locator, for correlation only. Do not use this string
 * as proof of authorization or as a replacement for the future internal
 * per-team resource UUID.
 */
export function resourceIdentityKey(ref: ResourceRef): string {
  const normalized = normalizeResourceRef(ref);
  return normalized.provider === "github_projects"
    ? "github_projects:" + normalized.owner + ":" + normalized.projectNumber
    : "jira:" + normalized.cloudId + ":" + normalized.projectId;
}

export function githubWorkItemRef(resource: GitHubProjectResourceRef, itemId: string): GitHubWorkItemRef {
  const normalized = normalizeResourceRef(resource);
  if (normalized.provider !== "github_projects") throw new Error("PROVIDER_RESOURCE_MISMATCH: Expected a GitHub Project.");
  return { provider: "github_projects", resource: normalized, itemId: bounded(itemId, "GitHub Project item ID", /^\S+$/, 256) };
}

export function jiraWorkItemRef(resource: JiraProjectResourceRef, issueId: string, issueKey?: string): JiraWorkItemRef {
  const normalized = normalizeResourceRef(resource);
  if (normalized.provider !== "jira") throw new Error("PROVIDER_RESOURCE_MISMATCH: Expected a Jira project.");
  const ref: JiraWorkItemRef = {
    provider: "jira",
    resource: normalized,
    issueId: bounded(issueId, "Jira issue ID", /^[0-9]+$/, 64),
  };
  return issueKey === undefined ? ref : {
    ...ref,
    issueKey: bounded(issueKey, "Jira issue key", /^[A-Za-z][A-Za-z0-9_]*-[0-9]+$/, 144).toUpperCase(),
  };
}

export function normalizeWorkItemRef(ref: WorkItemRef): WorkItemRef {
  if (!ref || typeof ref !== "object" || !("resource" in ref)) {
    throw new Error("WORK_ITEM_REF_INVALID: Work item reference is required.");
  }
  const resource = normalizeResourceRef(ref.resource);
  if (ref.provider !== resource.provider) throw new Error("PROVIDER_RESOURCE_MISMATCH: Work item and resource providers disagree.");
  if (resource.provider === "github_projects" && ref.provider === "github_projects") {
    return githubWorkItemRef(resource, ref.itemId);
  }
  if (resource.provider === "jira" && ref.provider === "jira") {
    return jiraWorkItemRef(resource, ref.issueId, ref.issueKey);
  }
  throw new Error("WORK_ITEM_REF_INVALID: Unsupported work item.");
}

export function workItemIdentityKey(ref: WorkItemRef): string {
  const normalized = normalizeWorkItemRef(ref);
  return resourceIdentityKey(normalized.resource) + ":" +
    (normalized.provider === "github_projects" ? normalized.itemId : normalized.issueId);
}
