import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { BulkPlanService } from "../core/bulk/bulk-plan-service.js";

interface Options {
  server: McpServer;
  bulk: BulkPlanService;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

const planReference = z.object({
  planId: z.string().regex(/^bulk-plan-[0-9a-f-]{36}$/),
  planDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export function registerBulkPlanTools({ server, bulk, json }: Options): void {
  server.registerTool(
    "preview_github_project_bulk_updates",
    {
      description: "Create an immutable, expiring M10-5 preview for 1-20 Status/Priority updates in one authorized Project. This performs reads and stores a plan but never mutates GitHub.",
      inputSchema: z.object({
        owner: z.string().min(1), number: z.number().int().min(1),
        operations: z.array(z.object({
          itemId: z.string().min(1), field: z.enum(["Status", "Priority"]), value: z.string().min(1),
        })).min(1).max(20),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ owner, number, operations }) => json(await bulk.preview(owner, number, operations)),
  );

  server.registerTool(
    "approve_github_project_bulk_plan",
    {
      description: "Explicitly approve the exact immutable bulk preview identified by plan ID and digest. The current maker-checker policy and bulk.approve capability are enforced; this does not mutate GitHub.",
      inputSchema: planReference,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ planId, planDigest }) => json(await bulk.approve(planId, planDigest)),
  );

  server.registerTool(
    "apply_github_project_bulk_plan",
    {
      description: "Apply one approved M10-5 bulk plan once. All operations are reauthorized and re-read before the first GitHub mutation; stale/preflight failures perform zero writes. Runtime failures stop remaining operations and are never auto-retried or rolled back.",
      inputSchema: planReference,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ planId, planDigest }) => json(await bulk.apply(planId, planDigest)),
  );

  server.registerTool(
    "get_github_project_bulk_plan",
    {
      description: "Read the durable state, immutable artifact, plan-level actor events and per-item results of an authorized M10 bulk plan. Project access and a bulk workflow capability are required.",
      inputSchema: z.object({ planId: planReference.shape.planId }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ planId }) => json(await bulk.get(planId)),
  );
}
