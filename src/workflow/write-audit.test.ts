import assert from "node:assert/strict";
import test from "node:test";

import { WriteAuditLog, auditFailureFromError } from "./write-audit.js";

const base = {
  operation: "update_status",
  projectId: "PVT_PROJECT",
  projectOwner: "gyuniverse-hq",
  projectNumber: 2,
  itemId: "PVTI_ITEM",
  fieldName: "Status",
  requestedValue: "Done",
  beforeValue: "In Progress",
  afterValue: "Done",
  verified: true,
  errorCode: null,
} as const;

test("keeps a bounded newest-first audit history", () => {
  const log = new WriteAuditLog(2);
  log.record({ ...base, outcome: "success", at: "2026-09-05T00:00:00.000Z" });
  log.record({ ...base, outcome: "no_change", requestedValue: "Done", at: "2026-09-05T00:01:00.000Z" });
  log.record({ ...base, outcome: "success", requestedValue: "Todo", at: "2026-09-05T00:02:00.000Z" });

  const entries = log.list();
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.requestedValue, "Todo");
  assert.equal(entries[1]?.outcome, "no_change");
  assert.equal(entries[0]?.id, "write-3");
});

test("filters by project and item without storing secrets or arbitrary payloads", () => {
  const log = new WriteAuditLog();
  log.record({ ...base, outcome: "success", actorId: "user:member" });
  log.record({ ...base, outcome: "success", projectId: "PVT_OTHER", itemId: "PVTI_OTHER" });

  assert.equal(log.list({ projectId: "PVT_PROJECT" }).length, 1);
  assert.equal(log.list({ itemId: "PVTI_OTHER" }).length, 1);
  assert.deepEqual(Object.keys(log.list()[0] ?? {}).sort(), [
    "actorId",
    "afterValue",
    "at",
    "beforeValue",
    "errorCode",
    "fieldName",
    "id",
    "itemId",
    "operation",
    "outcome",
    "projectId",
    "projectNumber",
    "projectOwner",
    "requestedValue",
    "verified",
  ]);
  assert.equal(log.list({ projectId: "PVT_PROJECT" })[0]?.actorId, "user:member");
});

test("classifies domain failure codes without recording error messages", () => {
  const failure = auditFailureFromError(
    {
      operation: "update_priority",
      actorId: "user:member",
      projectId: "PVT_PROJECT",
      projectOwner: "gyuniverse-hq",
      projectNumber: 2,
      itemId: "PVTI_ITEM",
      fieldName: "Priority",
      requestedValue: "High",
      beforeValue: null,
      afterValue: null,
    },
    new Error("PROJECT_FIELD_OPTION_NOT_FOUND: Option 'High' was not found."),
  );

  assert.equal(failure.outcome, "failed");
  assert.equal(failure.errorCode, "PROJECT_FIELD_OPTION_NOT_FOUND");
  assert.equal(failure.actorId, "user:member");
  assert.equal("message" in failure, false);
});
