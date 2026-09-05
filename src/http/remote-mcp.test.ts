import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../config.js";
import { configForRemoteScope } from "./remote-mcp.js";

const base: AppConfig = {
  githubToken: "test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_PROJECT"],
  writeEnabled: true,
};

test("remote OAuth read scope forces GitHub writes off even when server write gate is on", () => {
  const effective = configForRemoteScope(base, "projects:read");
  assert.equal(effective.writeEnabled, false);
  assert.deepEqual(effective.allowedProjectIds, ["PVT_PROJECT"]);
});

test("remote OAuth write scope never overrides a disabled server write gate", () => {
  const effective = configForRemoteScope({ ...base, writeEnabled: false }, "projects:read projects:write");
  assert.equal(effective.writeEnabled, false);
});

test("remote writes require both server write gate and OAuth write scope", () => {
  const effective = configForRemoteScope(base, "projects:read projects:write");
  assert.equal(effective.writeEnabled, true);
});
