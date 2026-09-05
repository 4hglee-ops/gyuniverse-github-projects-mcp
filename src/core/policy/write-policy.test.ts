import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import { principalForRole } from "../identity/principal.js";
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
  const decision = policy.authorize({ operation: "update_status", projectId: "PVT_allowed" });

  assert.equal(decision.allowed, true);
  assert.equal(decision.actorId, null);
  assert.equal(decision.identityEnforced, false);
  assert.equal(decision.permission, "item.update_status");
  assert.deepEqual(decision.controls, ["global-write-gate", "explicit-project-allowlist"]);
});

test("authorize fails closed when the global write gate is disabled", () => {
  const policy = new WritePolicy(config({ writeEnabled: false }), principalForRole("admin-1", "admin"));
  assert.throws(
    () => policy.authorize({ operation: "update_priority", projectId: "PVT_allowed" }),
    /write tools are disabled/,
  );
});

test("authorize fails closed when no explicit Project allowlist exists", () => {
  const policy = new WritePolicy(config({ allowedProjectIds: [] }), principalForRole("admin-1", "admin"));
  assert.throws(
    () => policy.authorize({ operation: "add_project_item", projectId: "PVT_allowed" }),
    /require GITHUB_PROJECTS_ALLOWED_PROJECT_IDS/,
  );
});

test("viewer cannot invoke write operations when a principal is enforced", () => {
  const policy = new WritePolicy(config(), principalForRole("viewer-1", "viewer"));
  assert.throws(
    () => policy.authorize({ operation: "update_status", projectId: "PVT_allowed" }),
    /PERMISSION_DENIED/,
  );
});

test("member can update status but cannot use generic field mutation", () => {
  const policy = new WritePolicy(config(), principalForRole("member-1", "member"));
  const decision = policy.authorize({ operation: "update_status", projectId: "PVT_allowed" });
  assert.equal(decision.actorId, "member-1");
  assert.equal(decision.identityEnforced, true);
  assert.equal(decision.permission, "item.update_status");
  assert.ok(decision.controls.includes("authenticated-principal"));

  assert.throws(
    () => policy.authorize({ operation: "update_project_item_field", projectId: "PVT_allowed" }),
    /PERMISSION_DENIED/,
  );
});

test("admin retains the current generic write surface", () => {
  const policy = new WritePolicy(config(), principalForRole("admin-1", "admin"));
  assert.doesNotThrow(() =>
    policy.authorize({ operation: "update_project_item_field", projectId: "PVT_allowed" }),
  );
});
