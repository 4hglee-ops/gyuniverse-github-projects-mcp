import assert from "node:assert/strict";
import test from "node:test";
import { principalForRole, principalHasProjectPermission } from "../identity/principal.js";
import { IdentityPolicy } from "../identity/identity-policy.js";
import { restrictPrincipalToTeamAccess, type TeamResourceGrant } from "./team-access.js";

const grant = (patch: Partial<TeamResourceGrant> = {}): TeamResourceGrant => ({
  teamId: "team-a", resourceId: "resource-a", provider: "github_projects",
  externalResourceId: "PVT_A", teamRole: "viewer", grantRole: "admin", permissions: null, ...patch,
});

test("team viewer cannot inherit admin capabilities on team A even when global principal is admin", () => {
  const principal = principalForRole("operator", "admin", { projectIds: ["PVT_A", "PVT_B"] });
  const scoped = restrictPrincipalToTeamAccess(principal, { grants: [
    grant(),
    grant({ teamId: "team-b", resourceId: "resource-b", externalResourceId: "PVT_B", teamRole: "admin" }),
  ] });
  assert.equal(principalHasProjectPermission(scoped, "PVT_A", "project.read"), true);
  assert.equal(principalHasProjectPermission(scoped, "PVT_A", "item.update_status"), false);
  assert.equal(principalHasProjectPermission(scoped, "PVT_B", "item.update_status"), true);
  assert.throws(() => new IdentityPolicy().assertProjectPermission(scoped, "PVT_A", "item.update_status"), /PERMISSION_DENIED/);
});

test("ungranted legacy project and cross-provider Jira grant cannot become GitHub membership", () => {
  const principal = principalForRole("operator", "admin", { projectIds: ["PVT_A", "PVT_B"] });
  const scoped = restrictPrincipalToTeamAccess(principal, { grants: [
    grant(),
    grant({ teamId: "team-b", resourceId: "jira-resource", provider: "jira", externalResourceId: "PVT_B" }),
  ] });
  assert.deepEqual(scoped.projectIds, ["PVT_A"]);
  assert.equal(principalHasProjectPermission(scoped, "PVT_B", "project.read"), false);
});

test("narrowed global role never widens through an admin grant", () => {
  const viewer = principalForRole("operator", "viewer", { projectIds: ["PVT_A"] });
  const scoped = restrictPrincipalToTeamAccess(viewer, { grants: [grant({ teamRole: "admin" })] });
  assert.equal(principalHasProjectPermission(scoped, "PVT_A", "item.update_status"), false);
});

test("permission override and duplicate project grants fail closed", () => {
  const principal = principalForRole("operator", "admin", { projectIds: ["PVT_A"] });
  assert.throws(() => restrictPrincipalToTeamAccess(principal, { grants: [
    grant({ grantRole: "viewer", permissions: ["item.assign"] }),
  ] }), /TEAM_ACL_INVALID/);
  assert.throws(() => restrictPrincipalToTeamAccess(principal, { grants: [
    grant(), grant({ teamId: "team-b", resourceId: "resource-b" }),
  ] }), /TEAM_ACL_AMBIGUOUS/);
});

test("empty and explicitly denied access are not silently widened", () => {
  const principal = principalForRole("operator", "admin", { projectIds: ["PVT_A"] });
  const empty = restrictPrincipalToTeamAccess(principal, { grants: [] });
  assert.deepEqual(empty.projectIds, []);
  const denied = restrictPrincipalToTeamAccess(principal, { grants: [grant({ permissions: [] })] });
  assert.deepEqual(denied.projectIds, []);
});
