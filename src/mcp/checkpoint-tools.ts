import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ProjectChangeService } from "../core/changes/project-change-service.js";

export interface RegisterCheckpointToolsOptions {
  server: McpServer;
  changes: ProjectChangeService;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

export function registerCheckpointTools({
  server,
  changes,
  json,
}: RegisterCheckpointToolsOptions): void {
  server.registerTool(
    "create_github_project_state_checkpoint",
    {
      description: "Capture the latest normalized state of an allowed GitHub Project as the process-local baseline for later delta comparison. This does not write to GitHub and replaces only the previous in-memory checkpoint for the same Project.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ owner, number, first }) => json(
      await changes.captureBaseline(owner, number, first),
    ),
  );

  server.registerTool(
    "compare_github_project_state_checkpoint",
    {
      description: "Compare the current normalized state of an allowed GitHub Project with its latest process-local checkpoint without replacing that checkpoint.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first }) => {
      const result = await changes.getChanges(owner, number, { first });
      return json({
        comparison: result.comparison,
        baseline: result.baseline,
        current: result.current,
        checkpointReplaced: result.checkpointReplaced,
      });
    },
  );
}
