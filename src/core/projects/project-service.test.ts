import assert from "node:assert/strict";
import test from "node:test";

import type { AppConfig } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { ProjectService, projectIdOf } from "./project-service.js";

class StubGraphQlClient extends GitHubGraphQlClient {
  constructor(private readonly handler: (query: string, variables: Record<string, unknown>) => unknown) {
    super("test-token");
  }

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return this.handler(query, variables) as T;
  }
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    githubToken: "test-token",
    allowedOwners: ["gyuniverse-hq"],
    allowedProjectIds: ["PVT_allowed"],
    writeEnabled: false,
    ...overrides,
  };
}

test("projectIdOf rejects malformed project responses", () => {
  assert.equal(projectIdOf({ id: "PVT_allowed" }), "PVT_allowed");
  assert.throws(() => projectIdOf(null), /did not contain a node ID/);
  assert.throws(() => projectIdOf({ id: "" }), /node ID is invalid/);
});

test("listProjects centralizes owner and project allowlist filtering", async () => {
  const client = new StubGraphQlClient(() => ({
    repositoryOwner: {
      projectsV2: {
        nodes: [
          { id: "PVT_allowed", number: 2, title: "Allowed" },
          { id: "PVT_hidden", number: 3, title: "Hidden" },
        ],
      },
    },
  }));
  const service = new ProjectService({ config: config(), client });

  const projects = await service.listProjects("gyuniverse-hq", 20) as Array<{ id: string }>;
  assert.deepEqual(projects.map((project) => project.id), ["PVT_allowed"]);
  await assert.rejects(() => service.listProjects("other-org", 20), /owner is not allowed/);
});

test("resolveProject applies the same Project allowlist boundary", async () => {
  const client = new StubGraphQlClient((_query, variables) => ({
    repositoryOwner: {
      projectV2: {
        id: variables.number === 2 ? "PVT_allowed" : "PVT_hidden",
        number: variables.number,
        title: "Project",
      },
    },
  }));
  const service = new ProjectService({ config: config(), client });

  const project = await service.resolveProject("gyuniverse-hq", 2) as { id: string };
  assert.equal(project.id, "PVT_allowed");
  await assert.rejects(() => service.resolveProject("gyuniverse-hq", 3), /Project is not allowed/);
});

test("read methods reuse resolveProject before fetching project data", async () => {
  const queries: string[] = [];
  const client = new StubGraphQlClient((query) => {
    queries.push(query);
    if (query.includes("fields(first: 100)")) {
      return { repositoryOwner: { projectV2: { fields: { nodes: [] } } } };
    }
    return {
      repositoryOwner: {
        projectV2: { id: "PVT_allowed", number: 2, title: "Allowed" },
      },
    };
  });
  const service = new ProjectService({ config: config(), client });

  assert.deepEqual(await service.listProjectFields("gyuniverse-hq", 2), []);
  assert.ok(queries.length >= 2);
});
