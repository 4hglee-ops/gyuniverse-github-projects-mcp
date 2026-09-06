import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AuditService } from "../core/audit/audit-service.js";
import { WritePolicy } from "../core/policy/write-policy.js";
import { HighLevelWriteService } from "../core/writes/high-level-write-service.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import type { WriteAuditEntry } from "../workflow/write-audit.js";
import { registerHighLevelWriteTools } from "./high-level-write-tools.js";

interface RegisterWorkflowWriteToolsOptions {
  server: McpServer;
  client: GitHubGraphQlClient;
  writePolicy: WritePolicy;
  auditService: AuditService;
  resolveProject: (owner: string, number: number) => Promise<unknown>;
  projectIdOf: (project: unknown) => string;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

export function writeAuditSummary(audit: WriteAuditEntry) {
  return {
    auditId: audit.id,
    actorId: audit.actorId,
    operation: audit.operation,
    outcome: audit.outcome,
    verified: audit.verified,
  };
}

export function registerWorkflowWriteTools(options: RegisterWorkflowWriteToolsOptions): void {
  const writes = new HighLevelWriteService({
    client: options.client,
    projects: { resolveProject: options.resolveProject },
    writePolicy: options.writePolicy,
    auditService: options.auditService,
  });

  // M8 semantic tools use Shared Core directly. The older MCP names remain as
  // compatibility aliases and intentionally call the exact same service methods.
  registerHighLevelWriteTools({ server: options.server, writes, json: options.json });

  options.server.registerTool(
    "update_github_project_item_status",
    {
      description: "Compatibility alias for the semantic Status write path. Safely sets one item's exact Status option by name with authorization, idempotency, verification, and actor-aware audit.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), itemId: z.string().min(1), status: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, status }) => options.json(
      await writes.updateWorkItemStatus(owner, number, itemId, status),
    ),
  );

  options.server.registerTool(
    "update_github_project_item_priority",
    {
      description: "Compatibility alias for the semantic Priority write path. Safely sets one item's exact Priority option by name with authorization, idempotency, verification, and actor-aware audit.",
      inputSchema: z.object({ owner: z.string().min(1), number: z.number().int().min(1), itemId: z.string().min(1), priority: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, priority }) => options.json(
      await writes.updateWorkItemPriority(owner, number, itemId, priority),
    ),
  );

  options.server.registerTool(
    "list_github_project_write_audit_log",
    {
      description: "List recent in-process GitHub Project write audit records. Records contain bounded operation metadata, actor identity, and verification results, not tokens or raw mutation payloads. On serverless deployments this process-local history is best-effort because later requests may reach a different instance; the write response itself includes the authoritative bounded audit summary for that operation.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50), projectId: z.string().min(1).optional(), itemId: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ limit, projectId, itemId }) => options.json(options.auditService.list({ limit, projectId, itemId })),
  );
}
