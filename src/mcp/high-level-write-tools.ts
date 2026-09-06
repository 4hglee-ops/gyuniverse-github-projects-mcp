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
}
