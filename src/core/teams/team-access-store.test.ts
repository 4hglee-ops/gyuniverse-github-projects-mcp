import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseTeamAccessStore } from "./team-access-store.js";

const url = "https://sample.supabase.co";

test("ACL DB request binds a verified subject and sends credentials only in server-side headers", async () => {
  let request: {url: string; init: RequestInit} | undefined;
  const store = new SupabaseTeamAccessStore(url, "test-service-role", async (endpoint, init) => {
    request = { url: endpoint, init };
    return {ok:true,status:200,json:async()=>[{
      teamId:"t1",resourceId:"r1",provider:"github_projects",externalResourceId:"PVT_A",
      teamRole:"viewer",grantRole:"viewer",permissions:null,
    }]};
  });
  const snapshot = await store.getSnapshot("user:test");
  assert.equal(snapshot.grants.length,1);
  assert.equal(request?.url, url+"/rest/v1/rpc/get_team_access_snapshot");
  assert.deepEqual(JSON.parse(String(request?.init.body)),{p_subject:"user:test"});
  assert.equal((request?.init.headers as Record<string,string>).Authorization,"Bearer test-service-role");
  assert.doesNotMatch(request?.url ?? "",/user:test|test-service-role/);
});

test("ACL DB rejects failures, malformed rows and bad server configuration", async () => {
  const unavailable = new SupabaseTeamAccessStore(url,"secret",async()=>({ok:false,status:500,json:async()=>[]}));
  await assert.rejects(unavailable.getSnapshot("subject"),/TEAM_ACL_UNAVAILABLE/);
  const malformed = new SupabaseTeamAccessStore(url,"secret",async()=>({ok:true,status:200,json:async()=>[{bad:true}]}));
  await assert.rejects(malformed.getSnapshot("subject"),/TEAM_ACL_INVALID/);
  assert.throws(()=>new SupabaseTeamAccessStore("http://remote.example","secret"),/TEAM_ACL_CONFIG_INVALID/);
  assert.throws(()=>new SupabaseTeamAccessStore(url,""),/TEAM_ACL_CONFIG_INVALID/);
});

test("new Supabase sb_secret key is only placed in apikey, never bearer Authorization", async () => {
  let sentHeaders: Record<string,string> | undefined;
  const store = new SupabaseTeamAccessStore(url, "sb_secret_testkey", async (_url, init) => {
    sentHeaders = init.headers as Record<string,string>;
    return {ok:true,status:200,json:async()=>[]};
  });
  await store.getSnapshot("user:test");
  assert.equal(sentHeaders?.apikey,"sb_secret_testkey");
  assert.equal(Object.hasOwn(sentHeaders ?? {}, "Authorization"),false);
});

test("publishable keys are refused for privileged team ACL reads", () => {
  assert.throws(
    () => new SupabaseTeamAccessStore(url,"sb_publishable_notprivileged"),
    /TEAM_ACL_CONFIG_INVALID/,
  );
});
