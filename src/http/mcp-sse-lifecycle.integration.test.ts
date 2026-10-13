import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { nowSeconds, signEnvelope, type AccessTokenPayload } from "../oauth/stateless.js";
import { handleRemoteMcpRequest } from "./remote-mcp.js";

const BASE = "https://transport-lifecycle.test.invalid";
const config: AppConfig = {
  githubToken: "unused-for-lifecycle-test",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT_LIFECYCLE_CI_ONLY"],
  writeEnabled: false,
};

class NeverCallGitHub extends GitHubGraphQlClient {
  constructor() { super("unused-for-lifecycle-test"); }
  override async request<T>(): Promise<T> {
    throw new Error("CI transport lifecycle must not access GitHub");
  }
}

async function boundedRead(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array> | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runProbe(useJson: boolean): Promise<{
  status: number;
  kind: "json" | "sse" | "other";
  sawResult: boolean;
  endedWithinWindow: boolean;
}> {
  const env: Record<string,string> = {
    PUBLIC_BASE_URL: BASE,
    MCP_OAUTH_SIGNING_SECRET: "ci-signed-only-lifecycle-test",
    MCP_OAUTH_IDENTITIES_JSON: JSON.stringify([{
      subject: "user:transport-lifecycle",
      accessCode: "ci-lifecycle-synthetic",
      role: "viewer",
      projectIds: ["PVT_LIFECYCLE_CI_ONLY"],
    }]),
    M12_TEAM_ACL_MODE: "legacy",
    MCP_LEGACY_JSON_TRANSPORT_ENABLED: useJson ? "true" : "false",
    MCP_HTTP_DIAGNOSTICS_ENABLED: "false",
  };
  const original = new Map<string,string|undefined>();
  for (const [key,value] of Object.entries(env)) {
    original.set(key,process.env[key]); process.env[key] = value;
  }
  let controller: AbortController | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const now = nowSeconds();
    const token = await signEnvelope("gypa", {
      typ:"access_token", aud: BASE + "/mcp",scope:"projects:read",
      sub:"user:transport-lifecycle",iat:now,exp:now+120,
    } satisfies AccessTokenPayload);
    controller = new AbortController();
    const request = new Request(BASE + "/mcp", {
      method:"POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json, text/event-stream",
        "Content-Type":"application/json",
      },
      signal:controller.signal,
      body:JSON.stringify({
        jsonrpc:"2.0", id:1, method:"tools/list",params:{},
      }),
    });
    const response = await handleRemoteMcpRequest(request,{config,client:new NeverCallGitHub()});
    assert.ok(response.body,"response body expected");
    const ct=response.headers.get("content-type")??"";
    const kind=ct.includes("event-stream")?"sse":ct.includes("application/json")?"json":"other";
    reader=response.body.getReader();
    let textBody="",closed=false;
    for (let n=0;n<30 && textBody.length<250_000;n++) {
      const next=await boundedRead(reader,450);
      if (next==="timeout") break;
      if (next.done){closed=true;break;}
      textBody += new TextDecoder().decode(next.value);
    }
    return {
      status:response.status,
      kind,
      sawResult: textBody.includes('"jsonrpc"') && textBody.includes('"result"'),
      endedWithinWindow:closed,
    };
  } finally {
    controller?.abort();
    if(reader) void reader.cancel().catch(()=>{});
    for (const [key,value] of original) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}

test("report default SSE lifecycle after tools/list terminal result", {timeout: 5_000},async()=>{
  const result=await runProbe(false);
  console.info("MCP_LIFECYCLE_BASELINE",JSON.stringify(result));
  assert.equal(result.status,200);
  assert.equal(result.kind,"sse");
  assert.equal(result.sawResult,true);
});

test("opt-in legacy JSON delivers tools/list and closes without waiting for SSE keepalive", {timeout:5_000},async()=>{
  const result=await runProbe(true);
  console.info("MCP_LIFECYCLE_JSON",JSON.stringify(result));
  assert.equal(result.status,200);
  assert.equal(result.kind,"json");
  assert.equal(result.sawResult,true);
  assert.equal(result.endedWithinWindow,true);
});
