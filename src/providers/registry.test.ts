import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectProvider } from "./provider.js";
import { ProjectProviderRegistry } from "./registry.js";

function githubProvider(): ProjectProvider {
  return {
    id: "github_projects",
    async listProjects() { return []; },
    async getProject() { return { id: "PVT_allowed" }; },
    async listFields() { return []; },
    async listItems() { return []; },
    async getSnapshot() { return { items: [] }; },
  };
}

test("registry returns the registered provider without modifying its behavior", async () => {
  const github = githubProvider();
  const registry = new ProjectProviderRegistry([github]);
  assert.equal(registry.require("github_projects"), github);
  assert.deepEqual(await registry.require("github_projects").getProject("gyuniverse-hq", 2), { id: "PVT_allowed" });
});

test("registry fails closed for unregistered Jira rather than selecting GitHub", () => {
  const registry = new ProjectProviderRegistry([githubProvider()]);
  assert.throws(() => registry.require("jira"), /PROVIDER_NOT_REGISTERED/);
});

test("registry rejects duplicate provider registrations", () => {
  const registry = new ProjectProviderRegistry([githubProvider()]);
  assert.throws(() => registry.register(githubProvider()), /PROVIDER_ALREADY_REGISTERED/);
});

test("separate request registries do not share provider instances", () => {
  const first = new ProjectProviderRegistry([githubProvider()]);
  const second = new ProjectProviderRegistry();
  assert.throws(() => second.require("github_projects"), /PROVIDER_NOT_REGISTERED/);
  assert.ok(first.require("github_projects"));
});
