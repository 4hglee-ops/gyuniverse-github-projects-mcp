import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectService } from "../../core/projects/project-service.js";
import { GitHubProjectsProvider } from "./github-projects-provider.js";

test("GitHub adapter delegates reads with unchanged parameters and results", async () => {
  const calls: unknown[][] = [];
  const data = { id: "PVT_allowed" };
  const projects: Pick<ProjectService,
    "listProjects" | "resolveProject" | "listProjectFields" |
    "listProjectItems" | "getProjectSnapshot"> = {
    async listProjects(...args) { calls.push(["list", ...args]); return [data]; },
    async resolveProject(...args) { calls.push(["get", ...args]); return data; },
    async listProjectFields(...args) { calls.push(["fields", ...args]); return []; },
    async listProjectItems(...args) { calls.push(["items", ...args]); return [data]; },
    async getProjectSnapshot(...args) { calls.push(["snapshot", ...args]); return data; },
  };
  const adapter = new GitHubProjectsProvider(projects);
  assert.equal(adapter.id, "github_projects");
  assert.deepEqual(await adapter.listProjects("gyuniverse-hq"), [data]);
  assert.equal(await adapter.getProject("gyuniverse-hq", 2), data);
  assert.deepEqual(await adapter.listFields("gyuniverse-hq", 2), []);
  assert.deepEqual(await adapter.listItems("gyuniverse-hq", 2), [data]);
  assert.equal(await adapter.getSnapshot("gyuniverse-hq", 2), data);
  assert.deepEqual(calls, [
    ["list", "gyuniverse-hq", 20],
    ["get", "gyuniverse-hq", 2],
    ["fields", "gyuniverse-hq", 2],
    ["items", "gyuniverse-hq", 2, 50],
    ["snapshot", "gyuniverse-hq", 2, 100],
  ]);
});

test("GitHub adapter propagates backing authorization failures", async () => {
  const deny = async (): Promise<never> => {
    throw new Error("PROJECT_MEMBERSHIP_DENIED: access denied");
  };
  const projects = {
    listProjects: async () => [],
    resolveProject: deny,
    listProjectFields: async () => [],
    listProjectItems: async () => [],
    getProjectSnapshot: async () => ({}),
  };
  const adapter = new GitHubProjectsProvider(projects);
  await assert.rejects(() => adapter.getProject("gyuniverse-hq", 2), /PROJECT_MEMBERSHIP_DENIED/);
});
