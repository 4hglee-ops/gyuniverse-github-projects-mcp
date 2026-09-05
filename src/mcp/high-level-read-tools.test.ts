import assert from "node:assert/strict";
import test from "node:test";

import { principalForRole } from "../core/identity/principal.js";
import { resolveMyWorkLogin } from "./high-level-read-tools.js";

test("authenticated get_my_work derives the principal GitHub login", () => {
  const principal = principalForRole("user:honggyu", "member", {
    githubLogin: "4hglee-ops",
    projectIds: ["PVT_allowed"],
    source: "oauth",
  });

  assert.equal(resolveMyWorkLogin(principal), "4hglee-ops");
  assert.equal(resolveMyWorkLogin(principal, "4HGLEE-OPS"), "4hglee-ops");
});

test("authenticated get_my_work rejects login impersonation", () => {
  const principal = principalForRole("user:member", "member", {
    githubLogin: "member-login",
    projectIds: ["PVT_allowed"],
  });

  assert.throws(
    () => resolveMyWorkLogin(principal, "someone-else"),
    /IDENTITY_LOGIN_MISMATCH/,
  );
});

test("authenticated get_my_work fails closed without a GitHub login mapping", () => {
  const principal = principalForRole("user:viewer", "viewer", {
    projectIds: ["PVT_allowed"],
  });
  assert.throws(() => resolveMyWorkLogin(principal), /IDENTITY_GITHUB_LOGIN_REQUIRED/);
});

test("local compatibility still requires explicit login when there is no principal", () => {
  assert.equal(resolveMyWorkLogin(null, "local-user"), "local-user");
  assert.throws(() => resolveMyWorkLogin(null), /login is required/);
});
