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

test("AuditService owns bounded process-local write history", async () => {
  const audit = new AuditService(2);
  const first = await audit.record(successEntry());
  await audit.record({ ...successEntry(), itemId: "PVTI_second" });
  await audit.record({ ...successEntry(), itemId: "PVTI_third" });

  const result = await audit.list();
  assert.equal(result.persistence, "process-local");
  assert.equal(result.survivesServerRestart, false);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.itemId, "PVTI_third");
  assert.equal(result.entries[1]?.itemId, "PVTI_second");
  assert.match(first.id, /^write-1$/);
});

test("AuditService preserves filtering semantics", async () => {
  const audit = new AuditService();
  await audit.record(successEntry());
  await audit.record({ ...successEntry(), projectId: "PVT_other", itemId: "PVTI_other" });

  assert.deepEqual(
    (await audit.list({ projectId: "PVT_allowed" })).entries.map((entry) => entry.projectId),
    ["PVT_allowed"],
  );
  assert.deepEqual(
    (await audit.list({ itemId: "PVTI_other" })).entries.map((entry) => entry.itemId),
    ["PVTI_other"],
  );
});

test("AuditService normalizes failure error codes", async () => {
  const audit = new AuditService();
  const entry = await audit.recordFailure(
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
  assert.equal(entry.capability, "item.update_status");
});

test("AuditService derives only the bounded capability name and never persists credentials", async () => {
  const audit = new AuditService();
  const entry = await audit.record({
    ...successEntry(),
    actorId: "user:admin",
    authorization: "Bearer secret",
    accessToken: "secret-token",
  } as ReturnType<typeof successEntry> & { actorId: string; authorization: string; accessToken: string });
  assert.equal(entry.capability, "item.update_status");
  assert.equal("authorization" in entry, false);
  assert.equal("accessToken" in entry, false);
  assert.equal(JSON.stringify(entry).includes("secret"), false);
});
