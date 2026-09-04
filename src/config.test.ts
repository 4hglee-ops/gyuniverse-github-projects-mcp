import assert from "node:assert/strict";
import test from "node:test";

import {
  type AppConfig,
  assertOwnerAllowed,
  assertProjectAllowed,
  assertProjectWriteAllowed,
} from "./config.js";

const config: AppConfig = {
  githubToken: "test-token",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_allowed"],
  writeEnabled: false,
};

test("owner and project allowlists reject values outside the boundary", () => {
  assert.doesNotThrow(() => assertOwnerAllowed(config, "gyuniverse-hq"));
  assert.throws(() => assertOwnerAllowed(config, "someone-else"), /owner is not allowed/);
  assert.doesNotThrow(() => assertProjectAllowed(config, "PVT_allowed"));
  assert.throws(() => assertProjectAllowed(config, "PVT_other"), /Project is not allowed/);
});

test("writes require both the global switch and an explicit project allowlist", () => {
  assert.throws(() => assertProjectWriteAllowed(config, "PVT_allowed"), /write tools are disabled/);

  assert.throws(
    () => assertProjectWriteAllowed({ ...config, writeEnabled: true, allowedProjectIds: [] }, "PVT_allowed"),
    /require GITHUB_PROJECTS_ALLOWED_PROJECT_IDS/,
  );

  assert.doesNotThrow(() =>
    assertProjectWriteAllowed({ ...config, writeEnabled: true }, "PVT_allowed"),
  );
});
