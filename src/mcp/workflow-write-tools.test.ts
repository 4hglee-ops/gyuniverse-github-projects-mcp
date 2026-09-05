import assert from "node:assert/strict";
import test from "node:test";

import { writeAuditSummary } from "./workflow-write-tools.js";
import type { WriteAuditEntry } from "../workflow/write-audit.js";

test("write response exposes bounded actor-aware audit metadata", () => {
  const audit: WriteAuditEntry = {
    id: "write-1",
    at: "2026-09-06T00:00:00.000Z",
    operation: "update_status",
    outcome: "no_change",
    actorId: "user:admin-validation",
    projectId: "PVT_PROJECT",
    projectOwner: "gyuniverse-hq",
    projectNumber: 2,
    itemId: "PVTI_ITEM",
    fieldName: "Status",
    requestedValue: "Todo",
    beforeValue: "Todo",
    afterValue: "Todo",
    verified: true,
    errorCode: null,
  };

  assert.deepEqual(writeAuditSummary(audit), {
    auditId: "write-1",
    actorId: "user:admin-validation",
    operation: "update_status",
    outcome: "no_change",
    verified: true,
  });
});
