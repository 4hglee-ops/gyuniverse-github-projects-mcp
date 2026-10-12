import assert from "node:assert/strict";
import test from "node:test";
import { previewMcpProbeEnabled } from "./preview-mcp-probe.js";
import { handleRemoteHttpRequest } from "./router.js";

test("preview probe is unavailable outside explicitly enabled preview runtime", async () => {
 const beforeEnv=process.env.VERCEL_ENV;
 const beforeEnabled=process.env.MCP_PREVIEW_TRANSPORT_PROBE_ENABLED;
 const beforeDiag=process.env.MCP_HTTP_DIAGNOSTICS_ENABLED;
 try {
  process.env.VERCEL_ENV="production";
  process.env.MCP_PREVIEW_TRANSPORT_PROBE_ENABLED="true";
  process.env.MCP_HTTP_DIAGNOSTICS_ENABLED="true";
  assert.equal(previewMcpProbeEnabled(),false);
  const response=await handleRemoteHttpRequest(new Request("https://example.test/api/v1/internal/preview-mcp-probe"));
  assert.equal(response.status,404);
  process.env.VERCEL_ENV="preview";
  delete process.env.MCP_PREVIEW_TRANSPORT_PROBE_ENABLED;
  assert.equal(previewMcpProbeEnabled(),false);
 } finally {
  if(beforeEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=beforeEnv;
  if(beforeEnabled===undefined)delete process.env.MCP_PREVIEW_TRANSPORT_PROBE_ENABLED;else process.env.MCP_PREVIEW_TRANSPORT_PROBE_ENABLED=beforeEnabled;
  if(beforeDiag===undefined)delete process.env.MCP_HTTP_DIAGNOSTICS_ENABLED;else process.env.MCP_HTTP_DIAGNOSTICS_ENABLED=beforeDiag;
 }
});
