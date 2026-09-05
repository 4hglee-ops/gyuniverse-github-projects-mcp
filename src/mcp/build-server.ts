import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  type AppConfig,
  assertOwnerAllowed,
  assertProjectAllowed,
  assertProjectWriteAllowed,
} from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { findProjectItemByContentId } from "../github/project-items.js";
import {
  addItemToProject,
  getProject,
  getProjectSnapshot,
  listProjectFields,
  listProjectItems,
  listProjects,
  updateProjectItemField,
} from "../github/projects.js";
import {
  parseGitHubIssueOrPullRequestUrl,
  resolveGitHubIssueOrPullRequest,
} from "../github/references.js";
import { analyzeProjectReconciliation } from "../workflow/reconciliation.js";
import { analyzeProjectStateGaps } from "../workflow/state-gaps.js";

export interface BuildServerOptions {
  config: AppConfig;
  client: GitHubGraphQlClient;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function projectIdOf(project: unknown): string {
  if (!project || typeof project !== "object" || !("id" in project)) {
    throw new Error("Project response did not contain a node ID.");
  }
  const id = (project as { id?: unknown }).id;
  if (typeof id !== "string" || !id) throw new Error("Project node ID is invalid.");
  return id;
}

export function buildMcpServer({ config, client }: BuildServerOptions): McpServer {
  const server = new McpServer({
    name: "gyuniverse-github-projects-mcp",
    version: "0.2.0",
  });

  async function resolveProject(owner: string, number: number): Promise<unknown> {
    assertOwnerAllowed(config, owner);
    const project = await getProject(client, owner, number);
    assertProjectAllowed(config, projectIdOf(project));
    return project;
  }

  server.registerTool(
    "list_github_projects",
    {
      description: "List GitHub Projects v2 for an allowed user or organization owner.",
      inputSchema: z.object({
        owner: z.string().min(1),
        first: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, first }) => {
      assertOwnerAllowed(config, owner);
      const projects = await listProjects(client, owner, first);
      const filtered = config.allowedProjectIds.length === 0
        ? projects
        : projects.filter((project) => {
            try { return config.allowedProjectIds.includes(projectIdOf(project)); }
            catch { return false; }
          });
      return json(filtered);
    },
  );

  server.registerTool(
    "get_github_project",
    {
      description: "Get metadata for one GitHub Project v2 by owner and project number.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number }) => json(await resolveProject(owner, number)),
  );

  server.registerTool(
    "list_github_project_fields",
    {
      description: "List fields, single-select options, multi-select options, and iterations configured on a GitHub Project v2.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number }) => {
      await resolveProject(owner, number);
      return json(await listProjectFields(client, owner, number));
    },
  );

  server.registerTool(
    "list_github_project_items",
    {
      description: "List issues, pull requests, draft issues, assignees, and field values in a GitHub Project v2.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(50),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => {
      await resolveProject(owner, number);
      return json(await listProjectItems(client, owner, number, first));
    },
  );

  server.registerTool(
    "resolve_github_issue_or_pr_url",
    {
      description: "Resolve an allowed github.com Issue or Pull Request URL to its GraphQL content node ID and canonical metadata.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url }) => {
      const parsed = parseGitHubIssueOrPullRequestUrl(url);
      assertOwnerAllowed(config, parsed.owner);
      return json(await resolveGitHubIssueOrPullRequest(client, url));
    },
  );

  server.registerTool(
    "resolve_github_project_item",
    {
      description: "Resolve an allowed GitHub Issue or Pull Request URL to the matching item in an allowed GitHub Project, following Project item pagination when needed.",
      inputSchema: z.object({
        projectOwner: z.string().min(1),
        projectNumber: z.number().int().min(1),
        url: z.string().url(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ projectOwner, projectNumber, url }) => {
      const parsed = parseGitHubIssueOrPullRequestUrl(url);
      assertOwnerAllowed(config, parsed.owner);
      await resolveProject(projectOwner, projectNumber);
      const resolvedContent = await resolveGitHubIssueOrPullRequest(client, url);
      const projectItem = await findProjectItemByContentId(
        client,
        projectOwner,
        projectNumber,
        resolvedContent.contentId,
      );
      return json({ resolvedContent, projectItem });
    },
  );

  server.registerTool(
    "get_github_project_snapshot",
    {
      description: "Return a normalized snapshot of project metadata, fields, items, status, priority, iteration, repository, and assignees for AI team-state analysis.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => {
      await resolveProject(owner, number);
      return json(await getProjectSnapshot(client, owner, number, first));
    },
  );

  server.registerTool(
    "analyze_github_project_state_gaps",
    {
      description: "Analyze an allowed GitHub Project snapshot for missing Status and missing assignee gaps while preserving item evidence.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
        statusFieldName: z.string().min(1).default("Status"),
        assigneeFieldNames: z.array(z.string().min(1)).max(10).default(["Assignees", "Assignee"]),
        completedStatusNames: z.array(z.string().min(1)).max(20).default(["Done", "Completed", "Closed"]),
        includeArchived: z.boolean().default(false),
        includeCompletedForAssignee: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({
      owner,
      number,
      first,
      statusFieldName,
      assigneeFieldNames,
      completedStatusNames,
      includeArchived,
      includeCompletedForAssignee,
    }) => {
      await resolveProject(owner, number);
      const snapshot = await getProjectSnapshot(client, owner, number, first) as Parameters<typeof analyzeProjectStateGaps>[0];
      const analysis = analyzeProjectStateGaps(snapshot, {
        statusFieldName,
        assigneeFieldNames,
        completedStatusNames,
        includeArchived,
        includeCompletedForAssignee,
      });
      return json({
        ...analysis,
        coverage: {
          requestedItems: first,
          returnedItems: snapshot.itemCount ?? 0,
          completeBeyondFirstPage: false,
          note: "State-gap analysis currently uses the normalized snapshot path, which is bounded by the requested first value (max 100). Use the pagination-aware Project item resolver for exhaustive single-item lookup.",
        },
      });
    },
  );

  server.registerTool(
    "analyze_github_project_reconciliation",
    {
      description: "Compare Pull Request merge state with Project Status and surface evidence-backed workflow mismatches.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
        statusFieldName: z.string().min(1).default("Status"),
        completedStatusNames: z.array(z.string().min(1)).max(20).default(["Done", "Completed", "Closed"]),
        includeArchived: z.boolean().default(false),
        reportDoneButNotMerged: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({
      owner,
      number,
      first,
      statusFieldName,
      completedStatusNames,
      includeArchived,
      reportDoneButNotMerged,
    }) => {
      await resolveProject(owner, number);
      const snapshot = await getProjectSnapshot(client, owner, number, first) as Parameters<typeof analyzeProjectReconciliation>[0];
      const analysis = analyzeProjectReconciliation(snapshot, {
        statusFieldName,
        completedStatusNames,
        includeArchived,
        reportDoneButNotMerged,
      });
      return json({
        ...analysis,
        coverage: {
          requestedItems: first,
          returnedItems: snapshot.itemCount ?? 0,
          completeBeyondFirstPage: false,
          note: "Reconciliation currently uses the normalized snapshot path, which is bounded by the requested first value (max 100).",
        },
      });
    },
  );

  server.registerTool(
    "get_github_project_brief_context",
    {
      description: "Return normalized GitHub Project state plus a contract for producing a team brief without treating planned work as completed work.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => {
      await resolveProject(owner, number);
      const snapshot = await getProjectSnapshot(client, owner, number, first);
      return json({
        snapshot,
        contract: {
          sections: [
            "Project Overview",
            "In Progress",
            "Assigned Work",
            "Unassigned Work",
            "Blocked or At Risk",
            "Review or Merge Candidates",
            "Done",
            "State Gaps",
          ],
          rules: [
            "Project field values are workflow state, not proof that implementation is complete.",
            "Do not infer Done from an intention, assignment, or open pull request.",
            "Surface missing assignees, missing status, and inconsistent item/repository state as State Gaps.",
            "Preserve repository, issue/PR number, URL, assignee, status, priority, and iteration as evidence when present.",
          ],
        },
      });
    },
  );

  server.registerTool(
    "add_github_project_item",
    {
      description: "Add an existing GitHub Issue or Pull Request node to an allowed Project v2. Disabled by default and requires an explicit Project allowlist.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        contentId: z.string().min(1),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ projectId, contentId }) => {
      assertProjectWriteAllowed(config, projectId);
      return json(await addItemToProject(client, projectId, contentId));
    },
  );

  const fieldValueSchema = z.object({
    text: z.string().optional(),
    number: z.number().optional(),
    date: z.string().optional(),
    singleSelectOptionId: z.string().optional(),
    multiSelectOptionIds: z.array(z.string().min(1)).min(1).optional(),
    iterationId: z.string().optional(),
  }).refine((value) => Object.values(value).filter((item) => item !== undefined).length === 1, {
    message: "Exactly one field value must be provided.",
  });

  server.registerTool(
    "update_github_project_item_field",
    {
      description: "Update one text, number, date, single-select, multi-select, or iteration field on a Project v2 item. Disabled by default and requires an explicit Project allowlist.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        itemId: z.string().min(1),
        fieldId: z.string().min(1),
        value: fieldValueSchema,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ projectId, itemId, fieldId, value }) => {
      assertProjectWriteAllowed(config, projectId);
      return json(await updateProjectItemField(client, projectId, itemId, fieldId, value));
    },
  );

  return server;
}
