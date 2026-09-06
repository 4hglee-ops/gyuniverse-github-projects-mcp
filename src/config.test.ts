import assert from "node:assert/strict";
import test from "node:test";

import {
  type AppConfig,
  assertOwnerAllowed,
  assertProjectAllowed,
  assertProjectWriteAllowed,
  bulkApprovalModeFromEnvironment,
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

test("bulk approval mode defaults compatibly and rejects unknown policy values", () => {
  const before = process.env.M10_BULK_APPROVAL_MODE;
  try {
    delete process.env.M10_BULK_APPROVAL_MODE;
    assert.equal(bulkApprovalModeFromEnvironment(), "same_admin_allowed");
    process.env.M10_BULK_APPROVAL_MODE = "distinct_admin_required";
    assert.equal(bulkApprovalModeFromEnvironment(), "distinct_admin_required");
    process.env.M10_BULK_APPROVAL_MODE = "unsafe";
    assert.throws(() => bulkApprovalModeFromEnvironment(), /M10_BULK_APPROVAL_MODE/);
  } finally {
    if (before === undefined) delete process.env.M10_BULK_APPROVAL_MODE;
    else process.env.M10_BULK_APPROVAL_MODE = before;
  }
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
