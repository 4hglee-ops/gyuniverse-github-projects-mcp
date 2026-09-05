import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "./audit-service.js";

function successEntry() {
  return {
    operation: "update_status",
    outcome: "success" as const,
    projectId: "PVT_allowed",
    projectOwner: "gyuniverse-hq",
    projectNumber: 2,
    itemId: "PVTI_item",
    fieldName: "Status",
    requestedValue: "Done",
    beforeValue: "In Review",
    afterValue: "Done",
    verified: true,
    errorCode: null,
  };
}

test("AuditService owns bounded process-local write history", () => {
  const audit = new AuditService(2);
  const first = audit.record(successEntry());
  audit.record({ ...successEntry(), itemId: "PVTI_second" });
  audit.record({ ...successEntry(), itemId: "PVTI_third" });

  const result = audit.list();
  assert.equal(result.persistence, "process-local");
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.itemId, "PVTI_third");
  assert.equal(result.entries[1]?.itemId, "PVTI_second");
  assert.match(first.id, /^write-1$/);
});

test("AuditService preserves filtering semantics", () => {
  const audit = new AuditService();
  audit.record(successEntry());
  audit.record({ ...successEntry(), projectId: "PVT_other", itemId: "PVTI_other" });

  assert.deepEqual(
    audit.list({ projectId: "PVT_allowed" }).entries.map((entry) => entry.projectId),
    ["PVT_allowed"],
  );
  assert.deepEqual(
    audit.list({ itemId: "PVTI_other" }).entries.map((entry) => entry.itemId),
    ["PVTI_other"],
  );
});

test("AuditService normalizes failure error codes", () => {
  const audit = new AuditService();
  const entry = audit.recordFailure(
    {
      operation: "update_status",
      projectId: "PVT_allowed",
      projectOwner: "gyuniverse-hq",
      projectNumber: 2,
      itemId: "PVTI_item",
      fieldName: "Status",
      requestedValue: "Done",
      beforeValue: null,
      afterValue: null,
    },
    new Error("MUTATION_VERIFICATION_FAILED: write did not verify"),
  );

  assert.equal(entry.outcome, "failed");
  assert.equal(entry.verified, false);
  assert.equal(entry.errorCode, "MUTATION_VERIFICATION_FAILED");
});
