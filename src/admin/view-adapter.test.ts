import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminView } from "./view-adapter.js";
import { resolveVerifiedOperator } from "../http/operator-auth.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { signEnvelope } from "../oauth/stateless.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";

test("session View read adapter uses the same scoped identity/catalog and rejects unsupported routes", async (t) => {
  const env = { PUBLIC_BASE_URL: "https://adapter.example.invalid", MCP_OAUTH_SIGNING_SECRET: "synthetic-view-adapter-key-never-used-externally" };
  const old = new Map(Object.keys(env).map((k) => [k, process.env[k]])); Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of old) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const registry = new OAuthIdentityRegistry([{ subject: "user:admin", accessCode: "synthetic-adapter-code", role: "admin", projectIds: ["PVT"] }]);
  const now = Math.floor(Date.now() / 1000), token = await signEnvelope("gypa", { typ: "access_token", sub: "user:admin", aud: env.PUBLIC_BASE_URL + "/mcp", scope: "projects:read",
    iat: now, exp: now + 600, identityVersion: registry.credentialVersion("user:admin", env.MCP_OAUTH_SIGNING_SECRET) });
  const config = { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["PVT"], writeEnabled: true };
  const op = await resolveVerifiedOperator(token, config, { registry: () => registry, teamStore: () => null, bindingKey: env.MCP_OAUTH_SIGNING_SECRET });
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, vars: Record<string, unknown>): Promise<T> {
      assert.match(query, /query ProjectViewCatalog/); assert.deepEqual(vars.ids, ["PVT"]);
      return { nodes: [{ id: "PVT", owner: { login: "fixture-org" }, number: 3, title: "Fixture", viewerCanUpdate: true }] } as T;
    }
  }
  const runtime = { client: new Client("synthetic-unused") };
  const identity = await handleAdminView("identity", "GET", undefined, op, async () => op, runtime) as { subject: string };
  assert.equal(identity.subject, "user:admin");
  const catalog = await handleAdminView("project/catalog", "GET", undefined, op, async () => op, runtime) as { projects: Array<{ canWriteViews: boolean }> };
  assert.equal(catalog.projects[0]!.canWriteViews, false);
  await assert.rejects(() => handleAdminView("credentials", "POST", {}, op, async () => op, runtime), /ADMIN_ROUTE_NOT_FOUND/);
  await assert.rejects(() => handleAdminView("write/views/update", "GET", {}, op, async () => op, runtime), /ADMIN_ROUTE_NOT_FOUND/);
});
