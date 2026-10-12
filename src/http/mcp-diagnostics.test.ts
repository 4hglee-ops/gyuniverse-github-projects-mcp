import assert from "node:assert/strict";
import test from "node:test";
import { traceMcpRequest, type McpDiagnosticLog } from "./mcp-diagnostics.js";

test("disabled diagnostics returns untouched JSON response", async () => {
  const response = new Response('{"ok":true}', {headers:{"content-type":"application/json"}});
  assert.equal(await traceMcpRequest(new Request("https://example.test/mcp"), async()=>response, {enabled:false}), response);
});

test("enabled JSON diagnostics preserve status and never log request secrets", async () => {
  const events: McpDiagnosticLog[]=[];
  const request = new Request("https://example.test/mcp?secret=hidden",{
    method:"POST",headers:{"Authorization":"Bearer very-secret"}
  });
  const response = await traceMcpRequest(request,async mark=>{
    mark("oauth_verified");
    return new Response("Unauthorized",{status:401});
  },{enabled:true,logger:e=>events.push(e)});
  assert.equal(response.status,401);
  assert.equal(await response.text(),"Unauthorized");
  assert.deepEqual(events.map(e=>e.event),["started","stage","response_ready","sse_complete"]);
  assert.doesNotMatch(JSON.stringify(events),/secret|hidden|example.test/);
});

test("SSE bytes pass through unmodified and lifecycle records completion",async()=>{
  const events:McpDiagnosticLog[]=[];
  const payload="data: hello\n\ndata: world\n\n";
  const upstream=new Response(new ReadableStream<Uint8Array>({
    start(controller){ controller.enqueue(new TextEncoder().encode(payload));controller.close(); }
  }),{headers:{"content-type":"text/event-stream; charset=utf-8"}});
  const response=await traceMcpRequest(new Request("https://example.test/mcp"),async()=>upstream,
    {enabled:true,logger:e=>events.push(e)});
  assert.equal(response.headers.get("content-type"),"text/event-stream; charset=utf-8");
  assert.equal(await response.text(),payload);
  assert.ok(events.some(e=>e.event==="sse_first_chunk"));
  assert.ok(events.some(e=>e.event==="sse_complete"));
});

test("SSE cancellation is reported without consuming entire upstream stream",async()=>{
  const events:McpDiagnosticLog[]=[];
  let cancelled=false;
  const upstream=new Response(new ReadableStream<Uint8Array>({
    pull(controller){controller.enqueue(new TextEncoder().encode("data: open\n\n"));},
    cancel(){cancelled=true;}
  }),{headers:{"content-type":"text/event-stream"}});
  const response=await traceMcpRequest(new Request("https://example.test/mcp"),async()=>upstream,
    {enabled:true,logger:e=>events.push(e)});
  await response.body?.cancel();
  assert.equal(cancelled,true);
  assert.ok(events.some(e=>e.event==="sse_cancelled"));
});
