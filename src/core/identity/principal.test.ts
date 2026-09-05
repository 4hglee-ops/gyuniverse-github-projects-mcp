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
});

test("admin receives the full current write surface", () => {
  const admin = principalForRole("admin-1", "admin", { projectIds: ["PVT_allowed"] });
  assert.equal(principalHasPermission(admin, "project.write"), true);
  assert.equal(principalHasPermission(admin, "item.update_field"), true);
});
