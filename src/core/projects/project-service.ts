import {
  type AppConfig,
  assertOwnerAllowed,
  assertProjectAllowed,
} from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import {
  getProject,
  getProjectSnapshot,
  listProjectFields,
  listProjectItems,
  listProjects,
} from "../../github/projects.js";

export function projectIdOf(project: unknown): string {
  if (!project || typeof project !== "object" || !("id" in project)) {
    throw new Error("Project response did not contain a node ID.");
  }

  const id = (project as { id?: unknown }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Project node ID is invalid.");
  }

  return id;
}

export interface ProjectServiceOptions {
  config: AppConfig;
  client: GitHubGraphQlClient;
}

/**
 * Shared business boundary for GitHub Projects read operations.
 *
 * Transport adapters should call this service instead of duplicating owner/project
 * allowlist checks around low-level GitHub API functions. M5 migrates callers into
 * this service incrementally so the existing MCP behavior stays stable while a REST
 * adapter can reuse the same logic later.
 */
export class ProjectService {
  constructor(private readonly options: ProjectServiceOptions) {}

  async listProjects(owner: string, first = 20): Promise<unknown[]> {
    assertOwnerAllowed(this.options.config, owner);
    const projects = await listProjects(this.options.client, owner, first);

    if (this.options.config.allowedProjectIds.length === 0) {
      return projects;
    }

    return projects.filter((project) => {
      try {
        return this.options.config.allowedProjectIds.includes(projectIdOf(project));
      } catch {
        return false;
      }
    });
  }

  async resolveProject(owner: string, number: number): Promise<unknown> {
    assertOwnerAllowed(this.options.config, owner);
    const project = await getProject(this.options.client, owner, number);
    assertProjectAllowed(this.options.config, projectIdOf(project));
    return project;
  }

  async listProjectFields(owner: string, number: number): Promise<unknown[]> {
    await this.resolveProject(owner, number);
    return listProjectFields(this.options.client, owner, number);
  }

  async listProjectItems(owner: string, number: number, first = 50): Promise<unknown[]> {
    await this.resolveProject(owner, number);
    return listProjectItems(this.options.client, owner, number, first);
  }

  async getProjectSnapshot(owner: string, number: number, first = 100): Promise<unknown> {
    await this.resolveProject(owner, number);
    return getProjectSnapshot(this.options.client, owner, number, first);
  }
}
