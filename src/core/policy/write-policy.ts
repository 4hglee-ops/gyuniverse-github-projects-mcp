import {
  type AppConfig,
  assertProjectWriteAllowed,
} from "../../config.js";
import { IdentityPolicy } from "../identity/identity-policy.js";
import type {
  AuthenticatedPrincipal,
  ProjectPermission,
} from "../identity/principal.js";

export type WriteOperation =
  | "add_project_item"
  | "assign_work_item"
  | "capture_backlog"
  | "create_work_item"
  | "update_project_item_field"
  | "update_status"
  | "update_priority"
  | "add_sub_issue"
  | "remove_sub_issue"
  | "add_blocked_by"
  | "remove_blocked_by";

const OPERATION_PERMISSION: Record<WriteOperation, ProjectPermission> = {
  add_project_item: "item.add",
  assign_work_item: "item.assign",
  capture_backlog: "item.add",
  create_work_item: "item.create",
  update_project_item_field: "item.update_field",
  update_status: "item.update_status",
  update_priority: "item.update_priority",
  add_sub_issue: "item.relationship.write",
  remove_sub_issue: "item.relationship.write",
  add_blocked_by: "item.relationship.write",
  remove_blocked_by: "item.relationship.write",
};

export interface WritePolicyRequest {
  operation: WriteOperation;
  projectId: string;
}

export interface WritePolicyDecision {
  allowed: true;
  operation: WriteOperation;
  projectId: string;
  actorId: string | null;
  identityEnforced: boolean;
  permission: ProjectPermission;
  controls: readonly string[];
}

/** Shared authorization boundary for GitHub Project mutations. */
export class WritePolicy {
  private readonly identity = new IdentityPolicy();

  constructor(
    private readonly config: AppConfig,
    private readonly principal: AuthenticatedPrincipal | null = null,
  ) {}

  authorize(request: WritePolicyRequest): WritePolicyDecision {
    assertProjectWriteAllowed(this.config, request.projectId);
    const permission = OPERATION_PERMISSION[request.operation];
    if (permission === "item.relationship.write") {
      this.identity.assertPermission(this.principal, permission);
    }

    if (this.principal) {
      this.identity.assertProjectMembership(this.principal, request.projectId);
      this.identity.assertPermission(this.principal, "project.write");
      this.identity.assertPermission(this.principal, permission);
    }

    return {
      allowed: true,
      operation: request.operation,
      projectId: request.projectId,
      actorId: this.principal?.id ?? null,
      identityEnforced: Boolean(this.principal),
      permission,
      controls: this.principal
        ? [
            "global-write-gate",
            "explicit-project-allowlist",
            "authenticated-principal",
            "project-membership",
            "operation-permission",
          ]
        : ["global-write-gate", "explicit-project-allowlist"],
    };
  }
}
