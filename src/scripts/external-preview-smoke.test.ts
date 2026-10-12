import assert from "node:assert/strict";
import test from "node:test";
// @ts-ignore: standalone .mjs CLI test has no TypeScript declarations
import { parseCurlResponse } from "../../scripts/mcp-preview-external-smoke.mjs";

test("parse external Vercel curl response",()=>{
 const x=parseCurlResponse("HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 200\r\ncontent-type: application/json\r\n\r\n{\"ok\":true}");
 assert.equal(x.status,200);
 assert.equal(x.headers.get("content-type"),"application/json");
 assert.deepEqual(JSON.parse(x.body),{ok:true});
});
test("parse failed auth response without logging secrets",()=>{
 const x=parseCurlResponse("HTTP/2 401\nwww-authenticate: Bearer realm=\"test\"\n\nUnauthorized");
 assert.equal(x.status,401);
 assert.equal(x.headers.get("www-authenticate"),'Bearer realm="test"');
});
