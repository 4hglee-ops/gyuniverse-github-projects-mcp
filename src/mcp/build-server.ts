import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { type AppConfig } from "../config.js";
import { AuditService } from "../core/audit/audit-service.js";
import { ProjectChangeService } from "../core/changes/project-change-service.js";
import type { AuthenticatedPrincipal } from "../core/identity/principal.js";
import { ProjectMutationService } from "../core/mutations/project-mutation-service.js";
import { WritePolicy } from "../core/policy/write-policy.js";
import { ProjectService, projectIdOf } from "../core/projects/project-service.js";
import { HighLevelReadService } from "../core/reads/high-level-read-service.js";
import { SnapshotService } from "../core/snapshots/snapshot-service.js";
import { WorkItemService } from "../core/work-items/work-item-service.js";
import { WorkflowService } from "../core/workflow/workflow-service.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { registerCheckpointTools } from "./checkpoint-tools.js";
import { registerHighLevelReadTools } from "./high-level-read-tools.js";
import { registerWorkflowWriteTools } from "./workflow-write-tools.js";

export interface BuildServerOptions {
  config: AppConfig;
  client: GitHubGraphQlClient;
  principal?: AuthenticatedPrincipal | null;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer({ config, client, principal = null }: BuildServerOptions): McpServer {
  const server = new McpServer({ name: "gyuniverse-github-projects-mcp", version: "0.2.0" });

  const projectService = new ProjectService({ config, client, principal });
  const snapshotService = new SnapshotService(projectService);
  const workflowService = new WorkflowService(snapshotService);
  const highLevelReadService = new HighLevelReadService(snapshotService);
  const changeService = new ProjectChangeService(snapshotService);
  const workItemService = new WorkItemService({ config, client, projects: projectService });
  const writePolicy = new WritePolicy(config, principal);
  const auditService = new AuditService(200);
  const mutationService = new ProjectMutationService({ client, writePolicy, auditService });
  const resolveProject = projectService.resolveProject.bind(projectService);

  registerCheckpointTools({ server, changes: changeService, json });
  registerHighLevelReadTools({ server, reads: highLevelReadService, changes: changeService, principal, json });
  registerWorkflowWriteTools({ server, client, writePolicy, auditService, resolveProject, workItems: workItemService, projectIdOf, json });

  server.registerTool(
    "list_github_projects",
    {
      description: "List GitHub Projects v2 visible to the authenticated principal within the server owner/Project allowlists.",
      inputSchema: z.object({ owner: z.string().min(1), first: z.number().int().min(1).max(100).default(20) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, first }) => json(await projectService.listProjects(owner, first)),
  );

  server.registerTool(
    "get_github_project",
    {
      description: "Get metadata for one GitHub Project v2 after server allowlist and authenticated Project membership checks.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number }) => json(await projectService.resolveProject(owner, number)),
  );

  server.registerTool(
    "list_github_project_fields",
    {
      description: "List fields, single-select options, multi-select options, and iterations configured on an authorized GitHub Project v2.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number }) => json(await projectService.listProjectFields(owner, number)),
  );

  server.registerTool(
    "list_github_project_items",
    {
      description: "List issues, pull requests, draft issues, assignees, and field values in an authorized GitHub Project v2.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), first: z.number().int().min(1).max(100).default(50) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => json(await projectService.listProjectItems(owner, number, first)),
  );

  server.registerTool(
    "resolve_github_issue_or_pr_url",
    {
      description: "Resolve an allowed github.com Issue or Pull Request URL to its GraphQL content node ID and canonical metadata.",
      inputSchema: z.object({ url: z.string().url() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url }) => json(await workItemService.resolveWorkItemUrl(url)),
  );

  server.registerTool(
    "resolve_github_project_item",
    {
      description: "Resolve an allowed GitHub Issue or Pull Request URL to the matching item in an authorized GitHub Project, following Project item pagination when needed.",
      inputSchema: z.object({ projectOwner: z.string().min(1), projectNumber: z.number().int().min(1), url: z.string().url() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ projectOwner, projectNumber, url }) => json(await workItemService.resolveProjectItem(projectOwner, projectNumber, url)),
  );

  server.registerTool(
    "get_github_project_snapshot",
    {
      description: "Return a normalized snapshot of an authorized Project for AI team-state analysis.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), first: z.number().int().min(1).max(100).default(100) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => json(await snapshotService.getSnapshot(owner, number, first)),
  );

  server.registerTool(
    "analyze_github_project_state_gaps",
    {
      description: "Analyze an authorized GitHub Project snapshot for missing Status and missing assignee gaps while preserving item evidence.",
      inputSchema: z.object({
        owner: z.string().min(1), number: z.number().int().min(1), first: z.number().int().min(1).max(100).default(100),
        statusFieldName: z.string().min(1).default("Status"), assigneeFieldNames: z.array(z.string().min(1)).max(10).default(["Assignees", "Assignee"]),
        completedStatusNames: z.array(z.string().min(1)).max(20).default(["Done", "Completed", "Closed"]), includeArchived: z.boolean().default(false),
        includeCompletedForAssignee: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, statusFieldName, assigneeFieldNames, completedStatusNames, includeArchived, includeCompletedForAssignee }) => json(
      await workflowService.analyzeStateGaps(owner, number, first, { statusFieldName, assigneeFieldNames, completedStatusNames, includeArchived, includeCompletedForAssignee }),
    ),
  );

  server.registerTool(
    "analyze_github_project_reconciliation",
    {
      description: "Compare Pull Request merge state with Project Status and surface evidence-backed workflow mismatches for an authorized Project.",
      inputSchema: z.object({
        owner: z.string().min(1), number: z.number().int().min(1), first: z.number().int().min(1).max(100).default(100),
        statusFieldName: z.string().min(1).default("Status"), completedStatusNames: z.array(z.string().min(1)).max(20).default(["Done", "Completed", "Closed"]),
        includeArchived: z.boolean().default(false), reportDoneButNotMerged: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, statusFieldName, completedStatusNames, includeArchived, reportDoneButNotMerged }) => json(
      await workflowService.analyzeReconciliation(owner, number, first, { statusFieldName, completedStatusNames, includeArchived, reportDoneButNotMerged }),
    ),
  );

  server.registerTool(
    "get_github_project_brief_context",
    {
      description: "Return normalized authorized Project state plus a contract for producing a team brief without treating planned work as completed work.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), first: z.number().int().min(1).max(100).default(100) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => json(await workflowService.getBriefContext(owner, number, first)),
  );

  server.registerTool(
    "add_github_project_item",
    {
      description: "Add an existing GitHub Issue or Pull Request node to an authorized Project v2. Disabled by default and requires an explicit Project allowlist.",
      inputSchema: z.object({ projectId: z.string().min(1), contentId: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ projectId, contentId }) => json(await mutationService.addProjectItem(projectId, contentId)),
  );

  const fieldValueSchema = z.object({
    text: z.string().optional(), number: z.number().optional(), date: z.string().optional(), singleSelectOptionId: z.string().optional(),
    multiSelectOptionIds: z.array(z.string().min(1)).min(1).optional(), iterationId: z.string().optional(),
  }).refine((value) => Object.values(value).filter((item) => item !== undefined).length === 1, { message: "Exactly one field value must be provided." });

  server.registerTool(
    "update_github_project_item_field",
    {
      description: "Update one text, number, date, single-select, multi-select, or iteration field on an authorized Project v2 item. Disabled by default and requires an explicit Project allowlist.",
      inputSchema: z.object({ projectId: z.string().min(1), itemId: z.string().min(1), fieldId: z.string().min(1), value: fieldValueSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ projectId, itemId, fieldId, value }) => json(
      await mutationService.updateProjectItemField(projectId, itemId, fieldId, value),
    ),
  );

  return server;
}
