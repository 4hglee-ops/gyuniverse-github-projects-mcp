import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { HighLevelReadService } from "../core/reads/high-level-read-service.js";

interface RegisterHighLevelReadToolsOptions {
  server: McpServer;
  reads: HighLevelReadService;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

const projectInput = z.object({
  owner: z.string().min(1),
  number: z.number().int().min(1),
  first: z.number().int().min(1).max(100).default(100),
  includeArchived: z.boolean().default(false),
});

export function registerHighLevelReadTools({ server, reads, json }: RegisterHighLevelReadToolsOptions): void {
  server.registerTool(
    "get_project_brief",
    {
      description: "Return a concise evidence-backed Project operating brief with status/priority counts, in-progress work, review queue, unassigned work, and explicit blockers.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getProjectBrief(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_my_work",
    {
      description: "Return Project items assigned to one GitHub login. Login is explicit until M7 individual identity is available.",
      inputSchema: projectInput.extend({
        login: z.string().min(1),
        includeDone: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived, login, includeDone }) => json(
      await reads.getMyWork(owner, number, { first, includeArchived, login, includeDone }),
    ),
  );

  server.registerTool(
    "get_backlog",
    {
      description: "Return items whose Project Status is explicitly Backlog.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getBacklog(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_review_queue",
    {
      description: "Return items whose Project Status is explicitly In Review.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getReviewQueue(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_unassigned_work",
    {
      description: "Return non-completed Project items with no repository or Project assignee evidence.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getUnassignedWork(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_blockers",
    {
      description: "Return only explicitly evidenced blockers from Blocked status/fields/reasons; does not infer blockers from ordinary workflow state.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getBlockers(owner, number, { first, includeArchived }),
    ),
  );
}
