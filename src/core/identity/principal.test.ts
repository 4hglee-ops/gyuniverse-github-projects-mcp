import assert from "node:assert/strict";
import test from "node:test";

import {
  permissionsForRole,
  principalForRole,
  principalHasPermission,
  principalHasProject,
} from "./principal.js";

test("role permission matrix keeps viewer read-only", () => {
  assert.deepEqual(permissionsForRole("viewer"), ["project.read"]);
  const viewer = principalForRole("viewer-1", "viewer", { projectIds: ["PVT_allowed"] });
  assert.equal(principalHasPermission(viewer, "project.read"), true);
  assert.equal(principalHasPermission(viewer, "project.write"), false);
  assert.equal(principalHasProject(viewer, "PVT_allowed"), true);
});

test("member receives selected writes but not generic field mutation", () => {
  const member = principalForRole("member-1", "member", { projectIds: ["PVT_allowed"] });
  assert.equal(principalHasPermission(member, "item.add"), true);
  assert.equal(principalHasPermission(member, "item.update_status"), true);
  assert.equal(principalHasPermission(member, "item.update_priority"), true);
  assert.equal(principalHasPermission(member, "item.update_field"), false);
  assert.equal(principalHasPermission(member, "item.relationship.write"), false);
  assert.equal(principalHasPermission(member, "bulk.preview"), false);
  assert.equal(principalHasPermission(member, "bulk.approve"), false);
  assert.equal(principalHasPermission(member, "bulk.apply"), false);
});

test("admin receives the full current write surface", () => {
  const admin = principalForRole("admin-1", "admin", { projectIds: ["PVT_allowed"] });
  assert.equal(principalHasPermission(admin, "project.write"), true);
  assert.equal(principalHasPermission(admin, "item.update_field"), true);
  assert.equal(principalHasPermission(admin, "item.relationship.write"), true);
  assert.equal(principalHasPermission(admin, "bulk.preview"), true);
  assert.equal(principalHasPermission(admin, "bulk.approve"), true);
  assert.equal(principalHasPermission(admin, "bulk.apply"), true);
});

test("an explicit permission snapshot can narrow role defaults without changing role identity", () => {
  const approver = principalForRole("admin-approver", "admin", {
    projectIds: ["PVT_allowed"],
    permissions: ["project.read", "project.write", "bulk.approve"],
  });
  assert.equal(approver.role, "admin");
  assert.deepEqual(approver.permissions, ["project.read", "project.write", "bulk.approve"]);
  assert.equal(principalHasPermission(approver, "bulk.apply"), false);
  assert.throws(() => principalForRole("viewer-expanded", "viewer", {
    projectIds: ["PVT_allowed"], permissions: ["project.read", "bulk.apply"],
  }), /may narrow but not expand/);
});
