import type { BulkApprovalMode } from "../../config.js";

/** Maker-checker rule only. Capability and Project checks remain in WritePolicy. */
export class BulkApprovalPolicy {
  constructor(private readonly mode: BulkApprovalMode = "same_admin_allowed") {}

  assertApprover(createdBy: string, approverId: string): void {
    if (this.mode === "distinct_admin_required" && createdBy === approverId) {
      throw new Error(
        "DISTINCT_APPROVER_REQUIRED: This bulk plan must be approved by a different authorized admin.",
      );
    }
  }
}
