import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  type AppConfig,
  assertProjectWriteAllowed,
} from "../config.js";
import { ProjectService, projectIdOf } from "../core/projects/project-service.js";
import { SnapshotService } from "../core/snapshots/snapshot-service.js";
import { WorkItemService } from "../core/work-items/work-item-service.js";
import { WorkflowService } from "../core/workflow/workflow-service.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import {
  addItemToProject,
  updateProjectItemField,
} from "../github/projects.js";
import { registerCheckpointTools } from "./checkpoint-tools.js";
import { registerWorkflowWriteTools, writeAuditLog } from "./workflow-write-tools.js";

export interface BuildServerOptions {
  config: AppConfig;
  client: GitHubGraphQlClient;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer({ config, client }: BuildServerOptions): McpServer {
  const server = new McpServer({
    name: "gyuniverse-github-projects-mcp",
    version: "0.2.0",
  });

  const projectService = new ProjectService({ config, client });
  const snapshotService = new SnapshotService(projectService);
  const workflowService = new WorkflowService(snapshotService);
  const workItemService = new WorkItemService({ config, client, projects: projectService });
  const resolveProject = projectService.resolveProject.bind(projectService);

  registerCheckpointTools({ server, client, resolveProject, json });
  registerWorkflowWriteTools({ server, client, config, resolveProject, projectIdOf, json });

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
    async ({ owner, first }) => json(await projectService.listProjects(owner, first)),
  );

  server.registerTool(
    "get_github_project",
    {
      description: "Get metadata for one GitHub Project v2 by owner and project number.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number }) => json(await projectService.resolveProject(owner, number)),
  );

  server.registerTool(
    "list_github_project_fields",
    {
      description: "List fields, single-select options, multi-select options, and iterations configured on a GitHub Project v2.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number }) => json(await projectService.listProjectFields(owner, number)),
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
    async ({ owner, number, first }) => json(await projectService.listProjectItems(owner, number, first)),
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
    async ({ url }) => json(await workItemService.resolveWorkItemUrl(url)),
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
    async ({ projectOwner, projectNumber, url }) => json(
      await workItemService.resolveProjectItem(projectOwner, projectNumber, url),
    ),
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
    async ({ owner, number, first }) => json(await snapshotService.getSnapshot(owner, number, first)),
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
    }) => json(await workflowService.analyzeStateGaps(owner, number, first, {
      statusFieldName,
      assigneeFieldNames,
      completedStatusNames,
      includeArchived,
      includeCompletedForAssignee,
    })),
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
    }) => json(await workflowService.analyzeReconciliation(owner, number, first, {
      statusFieldName,
      completedStatusNames,
      includeArchived,
      reportDoneButNotMerged,
    })),
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
    async ({ owner, number, first }) => json(await workflowService.getBriefContext(owner, number, first)),
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
      try {
        const result = await addItemToProject(client, projectId, contentId);
        writeAuditLog.record({
          operation: "add_project_item",
          outcome: "success",
          projectId,
          projectOwner: null,
          projectNumber: null,
          itemId: null,
          fieldName: null,
          requestedValue: null,
          beforeValue: null,
          afterValue: null,
          verified: false,
          errorCode: null,
        });
        return json(result);
      } catch (error) {
        writeAuditLog.record({
          operation: "add_project_item",
          outcome: "failed",
          projectId,
          projectOwner: null,
          projectNumber: null,
          itemId: null,
          fieldName: null,
          requestedValue: null,
          beforeValue: null,
          afterValue: null,
          verified: false,
          errorCode: "WRITE_FAILED",
        });
        throw error;
      }
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
      try {
        const result = await updateProjectItemField(client, projectId, itemId, fieldId, value);
        writeAuditLog.record({
          operation: "update_project_item_field",
          outcome: "success",
          projectId,
          projectOwner: null,
          projectNumber: null,
          itemId,
          fieldName: null,
          requestedValue: null,
          beforeValue: null,
          afterValue: null,
          verified: false,
          errorCode: null,
        });
        return json(result);
      } catch (error) {
        writeAuditLog.record({
          operation: "update_project_item_field",
          outcome: "failed",
          projectId,
          projectOwner: null,
          projectNumber: null,
          itemId,
          fieldName: null,
          requestedValue: null,
          beforeValue: null,
          afterValue: null,
          verified: false,
          errorCode: "WRITE_FAILED",
        });
        throw error;
      }
    },
  );

  return server;
}
