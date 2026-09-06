import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../audit/audit-service.js";
import { principalForRole } from "../identity/principal.js";
import { WritePolicy } from "../policy/write-policy.js";
import { HighLevelWriteService } from "./high-level-write-service.js";
import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import type { NamedSingleSelectUpdateInput } from "../../workflow/single-select-update.js";

const config: AppConfig = {
  githubToken: "test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_PROJECT"],
  writeEnabled: true,
};

function createService(calls: NamedSingleSelectUpdateInput[]) {
  const auditService = new AuditService();
  const service = new HighLevelWriteService({
    client: {} as GitHubGraphQlClient,
    projects: {
      async resolveProject() {
        return { id: "PVT_PROJECT", number: 2, title: "Bid Change Validator · WBS" };
      },
    },
    writePolicy: new WritePolicy(config),
    auditService,
    async updateNamedSingleSelect(_client, input) {
      calls.push(input);
      return {
        changed: false,
        verified: true,
        project: { id: input.projectId, number: input.projectNumber, title: "Bid Change Validator · WBS" },
        itemId: input.itemId,
        field: { id: input.fieldName === "Status" ? "STATUS_FIELD" : "PRIORITY_FIELD", name: input.fieldName },
        requestedOption: { id: "OPTION", name: input.optionName },
        before: { id: "OPTION", name: input.optionName },
        after: { id: "OPTION", name: input.optionName },
        mutationSkippedReason: "already_at_requested_option",
      };
    },
  });
  return { service, auditService };
}

test("semantic status update is idempotent, verified, and audited", async () => {
  const calls: NamedSingleSelectUpdateInput[] = [];
  const { service } = createService(calls);

  const result = await service.updateWorkItemStatus("gyuniverse-hq", 2, "PVTI_ITEM", "Todo");

  assert.equal(result.changed, false);
  assert.equal(result.verified, true);
  assert.equal(result.operation, "update_status");
  assert.equal(result.outcome, "no_change");
  assert.equal(result.auditId, "write-1");
  assert.deepEqual(calls.map(({ fieldName, optionName }) => ({ fieldName, optionName })), [
    { fieldName: "Status", optionName: "Todo" },
  ]);
});

test("startWork maps semantic intent to exact In Progress status", async () => {
  const calls: NamedSingleSelectUpdateInput[] = [];
  const { service } = createService(calls);

  const result = await service.startWork("gyuniverse-hq", 2, "PVTI_ITEM");

  assert.equal(result.operation, "update_status");
  assert.equal(calls[0]?.fieldName, "Status");
  assert.equal(calls[0]?.optionName, "In Progress");
});

test("semantic priority update uses Priority field", async () => {
  const calls: NamedSingleSelectUpdateInput[] = [];
  const { service } = createService(calls);

  const result = await service.updateWorkItemPriority("gyuniverse-hq", 2, "PVTI_ITEM", "P1");

  assert.equal(result.operation, "update_priority");
  assert.equal(calls[0]?.fieldName, "Priority");
  assert.equal(calls[0]?.optionName, "P1");
});

test("assignWorkItem is idempotent, verified, actor-aware, and audited", async () => {
  const auditService = new AuditService();
  const principal = principalForRole("user:admin-validation", "admin", {
    projectIds: ["PVT_PROJECT"],
  });
  const calls: Array<{ projectId: string; itemId: string; assigneeLogin: string }> = [];
  const service = new HighLevelWriteService({
    client: {} as GitHubGraphQlClient,
    projects: {
      async resolveProject() {
        return { id: "PVT_PROJECT", number: 2, title: "Bid Change Validator · WBS" };
      },
    },
    writePolicy: new WritePolicy(config, principal),
    auditService,
    async assignWorkItem(_client, input) {
      calls.push(input);
      return {
        changed: false,
        verified: true,
        project: { id: input.projectId, number: 2, title: "Bid Change Validator · WBS" },
        itemId: input.itemId,
        content: { id: "ISSUE_NODE", type: "Issue" as const },
        requestedAssignee: { id: "USER_NODE", login: input.assigneeLogin },
        before: [{ id: "USER_NODE", login: input.assigneeLogin }],
        after: [{ id: "USER_NODE", login: input.assigneeLogin }],
        mutationSkippedReason: "already_assigned" as const,
      };
    },
  });

  const result = await service.assignWorkItem("gyuniverse-hq", 2, "PVTI_ITEM", "4hglee-ops");

  assert.equal(result.changed, false);
  assert.equal(result.verified, true);
  assert.equal(result.operation, "assign_work_item");
  assert.equal(result.outcome, "no_change");
  assert.equal(result.actorId, "user:admin-validation");
  assert.equal(result.auditId, "write-1");
  assert.deepEqual(calls, [{ projectId: "PVT_PROJECT", itemId: "PVTI_ITEM", assigneeLogin: "4hglee-ops" }]);

  const entries = auditService.list().entries;
  assert.equal(entries[0]?.fieldName, "Assignees");
  assert.equal(entries[0]?.requestedValue, "4hglee-ops");
  assert.equal(entries[0]?.outcome, "no_change");
});
