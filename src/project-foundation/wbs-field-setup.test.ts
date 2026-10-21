import assert from "node:assert/strict";
import test from "node:test";
import { KBEAUTY_WBS_FIELDS, assertKbeautyWbsTarget, planKbeautyWbsFields } from "./wbs-field-setup.js";

const status = { id: "status", name: "Status", dataType: "SINGLE_SELECT", options: [
  { name: "Backlog" }, { name: "Todo" }, { name: "In Progress" }, { name: "Done" },
] };

test("plans seven custom fields while preserving current Status", () => {
  const p = planKbeautyWbsFields([status]);
  assert.equal(p.fields.length, 7);
  assert.equal(p.readyForApply, true);
  assert.equal(p.missingFields.length, 7);
  assert.ok(p.warnings.some(w => w.includes("In Review")));
  assert.deepEqual(p.fields.find(f => f.name === "Priority")?.options, ["P0", "P1", "P2", "P3"]);
  assert.equal(KBEAUTY_WBS_FIELDS.find(f => f.name === "Part")?.options?.length, 5);
  assert.equal(KBEAUTY_WBS_FIELDS.find(f => f.name === "Target")?.options?.length, 8);
});

test("does not overwrite a compatible field", () => {
  const priority = { id: "p", name: "Priority", dataType: "SINGLE_SELECT", options: [
    { name: "P0" }, { name: "P1" }, { name: "P2" }, { name: "P3" },
  ] };
  const p = planKbeautyWbsFields([status, priority]);
  assert.equal(p.fields.find(f => f.name === "Priority")?.action, "skip-existing");
  assert.equal(p.missingFields.length, 6);
});

test("blocks incompatible types and missing existing options", () => {
  const p = planKbeautyWbsFields([status, { id: "p", name: "Priority", dataType: "TEXT" }]);
  assert.equal(p.readyForApply, false);
  assert.equal(p.fields.find(f => f.name === "Priority")?.action, "manual-review");
  const q = planKbeautyWbsFields([status, { id: "p", name: "Priority", dataType: "SINGLE_SELECT",
    options: [{ name: "P0" }, { name: "P1" }] }]);
  assert.equal(q.readyForApply, false);
  assert.match(q.fields.find(f => f.name === "Priority")?.reason ?? "", /P2/);
});

test("fails closed if Backlog is missing", () => {
  const p = planKbeautyWbsFields([{ ...status, options: [{ name: "Back Log" }] }]);
  assert.equal(p.readyForApply, false);
  assert.match(p.warnings[0] ?? "", /Backlog/);
});

test("rejects Project #2 and foreign Project IDs", () => {
  assert.throws(() => assertKbeautyWbsTarget("gyuniverse-hq", 2, "PVT_kwDOEzfCi84BidwG"), /TARGET_MISMATCH/);
  assert.throws(() => assertKbeautyWbsTarget("gyuniverse-hq", 3, "PVT_other"), /TARGET_MISMATCH/);
});
