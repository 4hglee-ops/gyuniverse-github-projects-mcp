import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { AuditService } from "../audit/audit-service.js";
import { principalForRole } from "../identity/principal.js";
import { WritePolicy } from "../policy/write-policy.js";
import { HighLevelWriteService } from "./high-level-write-service.js";

const config: AppConfig = {
  githubToken: "test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_PROJECT"],
  writeEnabled: true,
};

function backlogCapture() {
  return {
    changed: true,
    verified: true,
    addedToProject: true,
    itemId: "PVTI_ITEM",
    content: {
      id: "ISSUE_NODE",
      title: "New work",
      url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/77",
      repository: "gyuniverse-hq/bid-change-validator",
    },
    status: {
      changed: true,
      verified: true,
      project: { id: "PVT_PROJECT", number: 2, title: "Bid Change Validator · WBS" },
      itemId: "PVTI_ITEM",
      field: { id: "STATUS_FIELD", name: "Status" },
      requestedOption: { id: "BACKLOG", name: "Backlog" },
      before: null,
      after: { id: "BACKLOG", name: "Backlog" },
      mutationSkippedReason: null,
    },
    mutationSkippedReason: null,
  };
}

test("createWorkItem creates Issue, captures Backlog, verifies, and audits actor", async () => {
  const auditService = new AuditService();
  const principal = principalForRole("user:admin-validation", "admin", { projectIds: ["PVT_PROJECT"] });
  const createCalls: Array<Record<string, unknown>> = [];
  const captureCalls: Array<Record<string, unknown>> = [];

  const service = new HighLevelWriteService({
    client: {} as GitHubGraphQlClient,
    projects: { async resolveProject() { return { id: "PVT_PROJECT", number: 2 }; } },
    workItems: { async resolveProjectItem() { throw new Error("capture override owns this test"); } },
    writePolicy: new WritePolicy(config, principal),
    auditService,
    async createIssue(_client, input) {
      createCalls.push(input as unknown as Record<string, unknown>);
      return {
        id: "ISSUE_NODE",
        number: 77,
        title: input.title,
        url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/77",
        repository: "gyuniverse-hq/bid-change-validator",
      };
    },
    async captureBacklog(_client, _workItems, input) {
      captureCalls.push(input as unknown as Record<string, unknown>);
      return backlogCapture();
    },
  });

  const result = await service.createWorkItem(
    "gyuniverse-hq",
    2,
    "bid-change-validator",
    "New work",
    "Body",
  );

  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.equal(result.operation, "create_work_item");
  assert.equal(result.outcome, "success");
  assert.equal(result.actorId, "user:admin-validation");
  assert.equal(result.issue.number, 77);
  assert.equal(result.capture.status.after?.name, "Backlog");
  assert.equal(createCalls.length, 1);
  assert.equal(captureCalls.length, 1);
  assert.equal((await auditService.list()).entries[0]?.operation, "create_work_item");
});

test("member cannot create a repository Issue", async () => {
  const member = principalForRole("user:member-validation", "member", { projectIds: ["PVT_PROJECT"] });
  let created = false;
  const service = new HighLevelWriteService({
    client: {} as GitHubGraphQlClient,
    projects: { async resolveProject() { return { id: "PVT_PROJECT", number: 2 }; } },
    workItems: { async resolveProjectItem() { throw new Error("not reached"); } },
    writePolicy: new WritePolicy(config, member),
    auditService: new AuditService(),
    async createIssue() {
      created = true;
      throw new Error("should not run");
    },
  });

  await assert.rejects(
    () => service.createWorkItem("gyuniverse-hq", 2, "bid-change-validator", "Denied"),
    /PERMISSION_DENIED/,
  );
  assert.equal(created, false);
});

test("partial failure reports the created Issue URL", async () => {
  const admin = principalForRole("user:admin-validation", "admin", { projectIds: ["PVT_PROJECT"] });
  const service = new HighLevelWriteService({
    client: {} as GitHubGraphQlClient,
    projects: { async resolveProject() { return { id: "PVT_PROJECT", number: 2 }; } },
    workItems: { async resolveProjectItem() { throw new Error("not reached"); } },
    writePolicy: new WritePolicy(config, admin),
    auditService: new AuditService(),
    async createIssue() {
      return {
        id: "ISSUE_NODE",
        number: 78,
        title: "Partial",
        url: "https://github.com/gyuniverse-hq/bid-change-validator/issues/78",
        repository: "gyuniverse-hq/bid-change-validator",
      };
    },
    async captureBacklog() {
      throw new Error("capture failed");
    },
  });

  await assert.rejects(
    () => service.createWorkItem("gyuniverse-hq", 2, "bid-change-validator", "Partial"),
    /CREATE_WORK_ITEM_PARTIAL_FAILURE: Issue 'https:\/\/github.com\/gyuniverse-hq\/bid-change-validator\/issues\/78'/,
  );
});
