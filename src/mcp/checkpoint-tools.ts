import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { getProjectSnapshot } from "../github/projects.js";
import {
  compareProjectStateCheckpoint,
  createProjectStateCheckpoint,
  ProjectCheckpointStore,
  type ProjectSnapshotLike,
} from "../workflow/checkpoint.js";

export interface RegisterCheckpointToolsOptions {
  server: McpServer;
  client: GitHubGraphQlClient;
  resolveProject: (owner: string, number: number) => Promise<unknown>;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

export function registerCheckpointTools({
  server,
  client,
  resolveProject,
  json,
}: RegisterCheckpointToolsOptions): void {
  const checkpoints = new ProjectCheckpointStore();

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
    async ({ owner, number, first }) => {
      await resolveProject(owner, number);
      const snapshot = await getProjectSnapshot(client, owner, number, first) as ProjectSnapshotLike;
      const checkpoint = createProjectStateCheckpoint(snapshot, {
        owner,
        projectNumber: number,
        requestedItems: first,
      });
      checkpoints.set(checkpoint);
      return json({
        checkpoint,
        persistence: {
          kind: "process_local",
          survivesServerRestart: false,
          note: "The latest checkpoint is kept only in this MCP server process. Persistent storage is intentionally deferred until a later milestone requires it.",
        },
      });
    },
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
      await resolveProject(owner, number);
      const checkpoint = checkpoints.get(owner, number);
      if (!checkpoint) {
        throw new Error(
          `No process-local checkpoint exists for ${owner} Project #${number}. Create one first with create_github_project_state_checkpoint.`,
        );
      }

      const snapshot = await getProjectSnapshot(client, owner, number, first) as ProjectSnapshotLike;
      const current = createProjectStateCheckpoint(snapshot, {
        owner,
        projectNumber: number,
        requestedItems: first,
      });
      const comparison = compareProjectStateCheckpoint(checkpoint, current);

      return json({
        comparison,
        baseline: {
          createdAt: checkpoint.createdAt,
          sourceSnapshotAt: checkpoint.sourceSnapshotAt,
          itemCount: checkpoint.itemCount,
          coverage: checkpoint.coverage,
        },
        current: {
          sourceSnapshotAt: current.sourceSnapshotAt,
          itemCount: current.itemCount,
          coverage: current.coverage,
        },
        checkpointReplaced: false,
      });
    },
  );
}
