import {
  type AppConfig,
  assertProjectWriteAllowed,
} from "../../config.js";

export type WriteOperation =
  | "add_project_item"
  | "update_project_item_field"
  | "update_status"
  | "update_priority";

export interface WritePolicyRequest {
  operation: WriteOperation;
  projectId: string;
  actorId?: string | null;
}

export interface WritePolicyDecision {
  allowed: true;
  operation: WriteOperation;
  projectId: string;
  actorId: string | null;
  identityEnforced: false;
  controls: readonly [
    "global-write-gate",
    "explicit-project-allowlist",
  ];
}

/**
 * Shared authorization boundary for GitHub Project mutations.
 *
 * M5 centralizes the current server-level write controls here without pretending
 * that individual user authorization already exists. M7 can extend this boundary
 * with authenticated identity, membership, role, and operation permissions while
 * MCP and future REST adapters keep calling the same policy object.
 */
export class WritePolicy {
  constructor(private readonly config: AppConfig) {}

  authorize(request: WritePolicyRequest): WritePolicyDecision {
    assertProjectWriteAllowed(this.config, request.projectId);

    return {
      allowed: true,
      operation: request.operation,
      projectId: request.projectId,
      actorId: request.actorId ?? null,
      identityEnforced: false,
      controls: ["global-write-gate", "explicit-project-allowlist"],
    };
  }
}
