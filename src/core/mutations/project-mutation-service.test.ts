import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { AuditService } from "../audit/audit-service.js";
import { WritePolicy } from "../policy/write-policy.js";
import { ProjectMutationService } from "./project-mutation-service.js";

class StubGraphQlClient extends GitHubGraphQlClient {
  constructor(private readonly handler: (query: string, variables: Record<string, unknown>) => unknown) {
    super("test-token");
  }

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.handler(query, variables) as T;
  }
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    githubToken: "test-token",
    allowedOwners: ["gyuniverse-hq"],
    allowedProjectIds: ["PVT_allowed"],
    writeEnabled: true,
    ...overrides,
  };
}

test("addProjectItem authorizes, mutates, and records one audit entry", async () => {
  const client = new StubGraphQlClient((query) => {
    assert.match(query, /addProjectV2ItemById/);
    return { addProjectV2ItemById: { item: { id: "PVTI_1", type: "ISSUE" } } };
  });
  const audit = new AuditService(20);
  const service = new ProjectMutationService({
    client,
    writePolicy: new WritePolicy(config()),
    auditService: audit,
  });

  const result = await service.addProjectItem("PVT_allowed", "I_1") as { id: string };
  assert.equal(result.id, "PVTI_1");
  const entries = audit.list().entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.operation, "add_project_item");
  assert.equal(entries[0]?.outcome, "success");
});

test("write policy failure prevents mutation", async () => {
  let called = false;
  const client = new StubGraphQlClient(() => {
    called = true;
    return {};
  });
  const service = new ProjectMutationService({
    client,
    writePolicy: new WritePolicy(config({ writeEnabled: false })),
    auditService: new AuditService(20),
  });

  await assert.rejects(
    () => service.addProjectItem("PVT_allowed", "I_1"),
    /write tools are disabled/,
  );
  assert.equal(called, false);
});

test("mutation failures are normalized into shared audit records", async () => {
  const client = new StubGraphQlClient(() => {
    throw new Error("WRITE_FAILED: synthetic mutation failure");
  });
  const audit = new AuditService(20);
  const service = new ProjectMutationService({
    client,
    writePolicy: new WritePolicy(config()),
    auditService: audit,
  });

  await assert.rejects(
    () => service.updateProjectItemField("PVT_allowed", "PVTI_1", "PVTF_1", { text: "x" }),
    /synthetic mutation failure/,
  );
  const [entry] = audit.list().entries;
  assert.equal(entry?.outcome, "failed");
  assert.equal(entry?.errorCode, "WRITE_FAILED");
});
