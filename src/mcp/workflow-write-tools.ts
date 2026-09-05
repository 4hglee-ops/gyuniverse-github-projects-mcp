import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { type AppConfig } from "../config.js";
import { WritePolicy } from "../core/policy/write-policy.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { updateProjectSingleSelectByName } from "../workflow/single-select-update.js";
import { WriteAuditLog, auditFailureFromError } from "../workflow/write-audit.js";

export const writeAuditLog = new WriteAuditLog(200);

interface RegisterWorkflowWriteToolsOptions {
  server: McpServer;
  client: GitHubGraphQlClient;
  config: AppConfig;
  writePolicy: WritePolicy;
  resolveProject: (owner: string, number: number) => Promise<unknown>;
  projectIdOf: (project: unknown) => string;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

async function runNamedUpdate(
  options: RegisterWorkflowWriteToolsOptions,
  input: {
    owner: string;
    number: number;
    itemId: string;
    optionName: string;
    fieldName: "Status" | "Priority";
    operation: "update_status" | "update_priority";
  },
) {
  const project = await options.resolveProject(input.owner, input.number);
  const projectId = options.projectIdOf(project);
  options.writePolicy.authorize({ operation: input.operation, projectId });

  try {
    const result = await updateProjectSingleSelectByName(options.client, {
      owner: input.owner,
      projectNumber: input.number,
      projectId,
      itemId: input.itemId,
      fieldName: input.fieldName,
      optionName: input.optionName,
    });

    const audit = writeAuditLog.record({
      operation: input.operation,
      outcome: result.changed ? "success" : "no_change",
      projectId,
      projectOwner: input.owner,
      projectNumber: input.number,
      itemId: input.itemId,
      fieldName: input.fieldName,
      requestedValue: input.optionName,
      beforeValue: result.before?.name ?? null,
      afterValue: result.after?.name ?? null,
      verified: result.verified,
      errorCode: null,
    });

    return options.json({ ...result, auditId: audit.id });
  } catch (error) {
    writeAuditLog.record(auditFailureFromError({
      operation: input.operation,
      projectId,
      projectOwner: input.owner,
      projectNumber: input.number,
      itemId: input.itemId,
      fieldName: input.fieldName,
      requestedValue: input.optionName,
      beforeValue: null,
      afterValue: null,
    }, error));
    throw error;
  }
}

export function registerWorkflowWriteTools(options: RegisterWorkflowWriteToolsOptions): void {
  options.server.registerTool(
    "update_github_project_item_status",
    {
      description: "Safely set the Status of one item in an allowed GitHub Project using an exact Status option name. Verifies Project membership and re-reads the result after mutation. Disabled by default.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), itemId: z.string().min(1), status: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, status }) => runNamedUpdate(options, { owner, number, itemId, optionName: status, fieldName: "Status", operation: "update_status" }),
  );

  options.server.registerTool(
    "update_github_project_item_priority",
    {
      description: "Safely set the Priority of one item in an allowed GitHub Project using an exact Priority option name. Verifies Project membership and re-reads the result after mutation. Disabled by default.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), itemId: z.string().min(1), priority: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, priority }) => runNamedUpdate(options, { owner, number, itemId, optionName: priority, fieldName: "Priority", operation: "update_priority" }),
  );

  options.server.registerTool(
    "list_github_project_write_audit_log",
    {
      description: "List recent in-process GitHub Project write audit records. Records contain bounded operation metadata and verification results, not tokens or raw mutation payloads.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50), projectId: z.string().min(1).optional(), itemId: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit, projectId, itemId }) => options.json({ persistence: "process-local", entries: writeAuditLog.list({ limit, projectId, itemId }) }),
  );
}
