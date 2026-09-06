import assert from "node:assert/strict";
import test from "node:test";
import { principalForRole } from "./principal.js";
import { IdentityPolicy } from "./identity-policy.js";

test("authorization denials use stable codes and bounded non-credential identifiers", () => {
  const policy = new IdentityPolicy();
  const viewer = principalForRole(`viewer-${"x".repeat(400)}`, "viewer", { projectIds: ["PVT_allowed"] });
  assert.throws(() => policy.assertPermission(viewer, "bulk.apply"), (error: Error) => {
    assert.match(error.message, /^PERMISSION_DENIED:/);
    assert.ok(error.message.length < 400);
    assert.equal(error.message.includes("access-token"), false);
    return true;
  });
  assert.throws(() => policy.assertProjectMembership(viewer, `PVT_${"y".repeat(400)}`), (error: Error) => {
    assert.match(error.message, /^PROJECT_MEMBERSHIP_DENIED:/);
    assert.ok(error.message.length < 600);
    return true;
  });
});
