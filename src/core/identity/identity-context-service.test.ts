import assert from "node:assert/strict";
import test from "node:test";

import { principalForRole } from "./principal.js";
import { IdentityContextService } from "./identity-context-service.js";

test("returns bounded non-secret authenticated identity context", () => {
  const principal = principalForRole("user:honggyu", "admin", {
    source: "oauth",
    displayName: "Honggyu",
    githubLogin: "4hglee-ops",
    projectIds: ["PVT_allowed"],
  });
  const context = new IdentityContextService(principal).getContext();

  assert.equal(context.authenticated, true);
  assert.equal(context.subject, "user:honggyu");
  assert.equal(context.githubLogin, "4hglee-ops");
  assert.equal(context.role, "admin");
  assert.deepEqual(context.projectIds, ["PVT_allowed"]);
  assert.equal("accessCode" in context, false);
  assert.equal("token" in context, false);
});

test("returns an explicit unauthenticated context without inventing identity", () => {
  const context = new IdentityContextService(null).getContext();
  assert.equal(context.authenticated, false);
  assert.equal(context.subject, null);
  assert.deepEqual(context.permissions, []);
  assert.deepEqual(context.projectIds, []);
});
