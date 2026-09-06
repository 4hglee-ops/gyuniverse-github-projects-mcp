import assert from "node:assert/strict";
import test from "node:test";
import { BulkApprovalPolicy } from "./bulk-approval-policy.js";

test("same_admin_allowed preserves self approval and also permits distinct approvers", () => {
  const policy = new BulkApprovalPolicy("same_admin_allowed");
  assert.doesNotThrow(() => policy.assertApprover("admin-a", "admin-a"));
  assert.doesNotThrow(() => policy.assertApprover("admin-a", "admin-b"));
});

test("distinct_admin_required rejects creator self approval only", () => {
  const policy = new BulkApprovalPolicy("distinct_admin_required");
  assert.throws(() => policy.assertApprover("admin-a", "admin-a"), /DISTINCT_APPROVER_REQUIRED/);
  assert.doesNotThrow(() => policy.assertApprover("admin-a", "admin-b"));
});
