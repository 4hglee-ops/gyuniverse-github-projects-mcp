import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HighLevelWriteService } from "../core/writes/high-level-write-service.js";

interface RegisterHighLevelWriteToolsOptions {
  server: McpServer;
  writes: HighLevelWriteService;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

const targetInput = z.object({
  owner: z.string().min(1),
  number: z.number().int().min(1),
  itemId: z.string().min(1),
});

export function registerHighLevelWriteTools({ server, writes, json }: RegisterHighLevelWriteToolsOptions): void {
  server.registerTool(
    "update_work_item_status",
    {
      description: "Semantically update one authorized GitHub Project work item's Status by exact option name. Uses Shared Core authorization, idempotency, verification, and actor-aware audit.",
      inputSchema: targetInput.extend({ status: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, status }) => json(
      await writes.updateWorkItemStatus(owner, number, itemId, status),
    ),
  );

  server.registerTool(
    "update_work_item_priority",
    {
      description: "Semantically update one authorized GitHub Project work item's Priority by exact option name. Uses Shared Core authorization, idempotency, verification, and actor-aware audit.",
      inputSchema: targetInput.extend({ priority: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, priority }) => json(
      await writes.updateWorkItemPriority(owner, number, itemId, priority),
    ),
  );

  server.registerTool(
    "start_work",
    {
      description: "Move one authorized GitHub Project work item to the exact 'In Progress' Status using the same Shared Core write path.",
      inputSchema: targetInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId }) => json(
      await writes.startWork(owner, number, itemId),
    ),
  );

  server.registerTool(
    "assign_work_item",
    {
      description: "Assign a GitHub user to the Issue or Pull Request represented by one authorized Project item. Admin/PM only in the current policy. Resolves the login, skips an already-assigned user, verifies the assignment, and returns actor-aware audit metadata.",
      inputSchema: targetInput.extend({ assigneeLogin: z.string().min(1) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, itemId, assigneeLogin }) => json(
      await writes.assignWorkItem(owner, number, itemId, assigneeLogin),
    ),
  );

  server.registerTool(
    "capture_backlog",
    {
      description: "Capture an existing GitHub Issue or Pull Request URL into one authorized Project and ensure its Status is exactly 'Backlog'. If already captured in Backlog, returns no_change. Requires both item.add and item.update_status permissions before any mutation.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        url: z.string().url(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, url }) => json(
      await writes.captureBacklog(owner, number, url),
    ),
  );

  server.registerTool(
    "create_work_item",
    {
      description: "Create a new GitHub Issue under the same authorized Project owner, capture it into the Project, and verify exact Backlog Status. Admin/PM only in the current policy. Pre-authorizes create, add, and status permissions before Issue creation and reports a partial-failure error containing the created Issue URL if Project capture later fails.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        repository: z.string().min(1).regex(/^[A-Za-z0-9_.-]+$/),
        title: z.string().trim().min(1).max(256),
        body: z.string().max(65536).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ owner, number, repository, title, body }) => json(
      await writes.createWorkItem(owner, number, repository, title, body ?? null),
    ),
  );
}
