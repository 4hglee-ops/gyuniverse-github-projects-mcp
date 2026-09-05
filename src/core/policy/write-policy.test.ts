import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import { WritePolicy } from "./write-policy.js";

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    githubToken: "test-token",
    allowedOwners: ["gyuniverse-hq"],
    allowedProjectIds: ["PVT_allowed"],
    writeEnabled: true,
    ...overrides,
  };
}

test("authorize preserves the existing global gate and explicit Project allowlist", () => {
  const policy = new WritePolicy(config());
  const decision = policy.authorize({
    operation: "update_status",
    projectId: "PVT_allowed",
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.operation, "update_status");
  assert.equal(decision.projectId, "PVT_allowed");
  assert.equal(decision.actorId, null);
  assert.equal(decision.identityEnforced, false);
  assert.deepEqual(decision.controls, ["global-write-gate", "explicit-project-allowlist"]);
});

test("authorize fails closed when the global write gate is disabled", () => {
  const policy = new WritePolicy(config({ writeEnabled: false }));
  assert.throws(
    () => policy.authorize({ operation: "update_priority", projectId: "PVT_allowed" }),
    /write tools are disabled/,
  );
});

test("authorize fails closed when no explicit Project allowlist exists", () => {
  const policy = new WritePolicy(config({ allowedProjectIds: [] }));
  assert.throws(
    () => policy.authorize({ operation: "add_project_item", projectId: "PVT_allowed" }),
    /require GITHUB_PROJECTS_ALLOWED_PROJECT_IDS/,
  );
});

test("authorize rejects a Project outside the explicit allowlist", () => {
  const policy = new WritePolicy(config());
  assert.throws(
    () => policy.authorize({ operation: "update_project_item_field", projectId: "PVT_other" }),
    /Project is not allowed/,
  );
});

test("actor metadata can flow through before identity enforcement is added", () => {
  const policy = new WritePolicy(config());
  const decision = policy.authorize({
    operation: "update_status",
    projectId: "PVT_allowed",
    actorId: "user:test",
  });
  assert.equal(decision.actorId, "user:test");
  assert.equal(decision.identityEnforced, false);
});
