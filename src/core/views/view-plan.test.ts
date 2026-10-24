import assert from "node:assert/strict";
import test from "node:test";
import { createViewPlan, validateViewPlan, viewDigest, viewApplySchema, viewPreviewSchema } from "./view-plan.js";

const artifact = () => { const now = Date.now(); return ({ version: 1 as const, kind: "template" as const, owner: "fixture-org", number: 3, projectId: "PVT", createdBy: "fixture-admin",
  createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 900_000).toISOString(), baselineDigest: viewDigest("baseline"),
  actions: [{ action: "skip-compatible" as const, name: "Existing", reason: "Preserve", manual: [], viewId: "V", create: null, changes: null, expected: null }],
}); };
test("Plan digest ignores object key order and detects altered targets or actions", () => {
  assert.equal(viewDigest({ b: 2, a: 1 }), viewDigest({ a: 1, b: 2 }));
  const plan = createViewPlan(artifact());
  assert.match(plan.planId, /^view-plan-/);
  assert.equal(validateViewPlan(plan).planDigest, plan.planDigest);
  assert.throws(() => validateViewPlan({ ...plan, artifact: { ...plan.artifact, number: 2 } }), /VIEW_PLAN_INVALID/);
  assert.throws(() => validateViewPlan({ ...plan, credential: "must-not-be-stored" }), /VIEW_PLAN_INVALID/);
});
test("Plans reject invalid lifetimes and require exact explicit approval input", () => {
  const a = artifact();
  assert.throws(() => createViewPlan({ ...a, expiresAt: a.createdAt }), /VIEW_PLAN_INVALID/);
  assert.throws(() => createViewPlan({ ...a, expiresAt: new Date(Date.parse(a.createdAt) + 3_600_000).toISOString() }), /VIEW_PLAN_INVALID/);
  const plan = createViewPlan(a);
  const reference = { owner: "fixture-org", number: 3, planId: plan.planId, planDigest: plan.planDigest };
  assert.equal(viewApplySchema.safeParse(reference).success, false);
  assert.equal(viewApplySchema.safeParse({ ...reference, approved: false }).success, false);
  assert.equal(viewApplySchema.safeParse({ ...reference, approved: true }).success, true);
  assert.equal(viewPreviewSchema.safeParse({ owner: "fixture-org", number: 3, template: "wbs-v1", update: { viewId: "V", changes: { name: "x" } } }).success, false);
});
