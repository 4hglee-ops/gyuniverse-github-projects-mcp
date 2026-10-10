import assert from "node:assert/strict";
import test from "node:test";
import { principalForRole, principalHasProjectPermission } from "../identity/principal.js";
import { resolveTeamScopedPrincipal } from "./team-access-runtime.js";

test("legacy mode preserves the previous principal exactly", async () => {
  const principal=principalForRole("subject","admin",{projectIds:["PVT_A"]});
  assert.equal(await resolveTeamScopedPrincipal(principal,null),principal);
});

test("enforced mode restricts team-specific capabilities without cross-project elevation", async () => {
  const principal=principalForRole("subject","admin",{projectIds:["PVT_A","PVT_B"]});
  const scoped=await resolveTeamScopedPrincipal(principal,{async getSnapshot(){return {grants:[{
    teamId:"t1",resourceId:"r1",provider:"github_projects" as const,externalResourceId:"PVT_A",
    teamRole:"viewer" as const,grantRole:"admin" as const,permissions:null,
  }]};}});
  assert.deepEqual(scoped?.projectIds,["PVT_A"]);
  assert.equal(principalHasProjectPermission(scoped,"PVT_A","item.update_status"),false);
  assert.equal(principalHasProjectPermission(scoped,"PVT_B","project.read"),false);
});

test("DB failure denies requests without silently falling back to legacy permissions", async () => {
  const principal=principalForRole("subject","admin",{projectIds:["PVT_A"]});
  await assert.rejects(resolveTeamScopedPrincipal(principal,{async getSnapshot(){throw new Error("connection failed");}}),/TEAM_ACL_UNAVAILABLE/);
});

test("unknown or removed DB identity produces no project memberships", async () => {
  const principal=principalForRole("subject","admin",{projectIds:["PVT_A"]});
  const scoped=await resolveTeamScopedPrincipal(principal,{async getSnapshot(){return {grants:[]};}});
  assert.deepEqual(scoped?.projectIds,[]);
});
