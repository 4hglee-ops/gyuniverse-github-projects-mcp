import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  legacyJsonTransportEnabled,
  shouldUseLegacyJsonTransport,
  serveLegacyJsonTransport,
} from "./legacy-json-transport.js";

function request(method:string,body?:unknown,signal?:AbortSignal):Request {
  return new Request("https://example.test/mcp", {
    method,
    headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream"},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    ...(signal?{signal}:{})
  });
}
function makeServer(): McpServer {
  const server=new McpServer({name:"legacy-json-ci",version:"1.0"});
  server.registerTool("ping",{inputSchema:z.object({})},async()=>({content:[{type:"text",text:"pong"}]}));
  return server;
}
function withFeature(enabled:boolean,fn:()=>Promise<void>):Promise<void>{
  const old=process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED;
  if(enabled)process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED="true";
  else delete process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED;
  return fn().finally(()=>{if(old===undefined)delete process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED;else process.env.MCP_LEGACY_JSON_TRANSPORT_ENABLED=old;});
}

test("feature gate defaults off, affects only legacy POST",async()=>{
  await withFeature(false,async()=>{
    assert.equal(legacyJsonTransportEnabled(),false);
    assert.equal(await shouldUseLegacyJsonTransport(request("POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{}})),false);
  });
  await withFeature(true,async()=>{
    assert.equal(await shouldUseLegacyJsonTransport(request("POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{}})),true);
    assert.equal(await shouldUseLegacyJsonTransport(request("GET")),false);
    const modern=request("POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{
      _meta:{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
       "io.modelcontextprotocol/clientInfo":{name:"test",version:"1.0"},
       "io.modelcontextprotocol/clientCapabilities":{}}
    }});
    assert.equal(await shouldUseLegacyJsonTransport(modern),false);
  });
});

test("legacy JSON returns complete result without hanging on open SSE", {timeout:4000},async()=>{
  const response=await serveLegacyJsonTransport(request("POST",{jsonrpc:"2.0",id:7,method:"tools/list",params:{}}),makeServer);
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type")??"",/^application\/json/);
  const body=await response.json() as {result?:{tools?:unknown[]}};
  assert.ok(Array.isArray(body.result?.tools));
});

test("pre-aborted request returns 503 without constructing server", {timeout:4000},async()=>{
  const controller=new AbortController();
  controller.abort();
  let built=false;
  const result=await serveLegacyJsonTransport(request("POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{}},controller.signal),()=>{
    built=true;
    return makeServer();
  });
  assert.equal(result.status,503);
  assert.equal(built,false);
});

test("abort during an in-flight request settles transport and releases server", {timeout:5000},async()=>{
  const controller=new AbortController();
  const server=new McpServer({name:"abort-ci",version:"1.0"});
  let entered:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;});
  server.registerTool("wait",{inputSchema:z.object({})},async(_args,context)=>{
    entered();
    await new Promise<void>(resolve=>{
      if(context.mcpReq.signal.aborted){resolve();return;}
      context.mcpReq.signal.addEventListener("abort",()=>resolve(),{once:true});
    });
    return {content:[{type:"text",text:"cancelled"}]};
  });
  const pending=serveLegacyJsonTransport(request("POST",{jsonrpc:"2.0",id:9,method:"tools/call",params:{name:"wait",arguments:{}}},controller.signal),()=>server);
  await Promise.race([started,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("handler did not start")),1500))]);
  controller.abort();
  const response=await Promise.race([pending,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("abort did not settle")),2000))]);
  assert.ok([200,500,503].includes(response.status));
});
