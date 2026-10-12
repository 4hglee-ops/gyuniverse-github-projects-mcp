import assert from "node:assert/strict";
import test from "node:test";
import { principalForRole } from "../identity/principal.js";
import { assertGitHubAuthDiagnosticAllowed, probeGitHubAuthToken } from "./github-auth-status.js";

test("diagnostics allow scoped admin but not viewer or unknown admin", () => {
  assert.doesNotThrow(() => assertGitHubAuthDiagnosticAllowed(principalForRole("admin", "admin", {projectIds:["PVT_1"]})));
  assert.throws(() => assertGitHubAuthDiagnosticAllowed(principalForRole("viewer","viewer",{projectIds:["PVT_1"]})), /PERMISSION_DENIED/);
  assert.throws(() => assertGitHubAuthDiagnosticAllowed(principalForRole("admin","admin",{projectIds:[]})), /PERMISSION_DENIED/);
  assert.throws(() => assertGitHubAuthDiagnosticAllowed(null), /PERMISSION_DENIED/);
});

test("a valid GitHub viewer probe does not imply project access or expose identity", async () => {
  let auth = "";
  const result = await probeGitHubAuthToken("test-credential", async (_url, init) => {
    auth = (init.headers as Record<string,string>).Authorization;
    return {ok:true,status:200,headers:new Headers(),json:async()=>({data:{viewer:{id:"private-actor-id"}}})};
  });
  assert.equal(auth,"Bearer test-credential");
  assert.equal(result.tokenStatus,"valid");
  assert.equal(result.projectAccess,"not_checked");
  assert.doesNotMatch(JSON.stringify(result),/credential|private-actor-id/);
});

test("401 is invalid while rate limit and upstream errors are not misreported as expired", async () => {
  const response = (status:number,headers:Headers=new Headers()) => ({
    ok: status >= 200 && status < 300, status,headers,json:async()=>({}),
  });
  assert.equal((await probeGitHubAuthToken("key",async()=>response(401))).tokenStatus,"invalid");
  assert.equal((await probeGitHubAuthToken("key",async()=>response(403,new Headers({"x-ratelimit-remaining":"0"})))).tokenStatus,"rate_limited");
  assert.equal((await probeGitHubAuthToken("key",async()=>response(403))).tokenStatus,"unknown");
  assert.equal((await probeGitHubAuthToken("key",async()=>response(500))).tokenStatus,"unknown");
  assert.equal((await probeGitHubAuthToken("key",async()=>{throw new Error("some secret");})).tokenStatus,"unknown");
});
