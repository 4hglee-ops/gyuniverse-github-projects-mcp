import {
  type AppConfig,
  assertOwnerAllowed,
  assertProjectAllowed,
} from "../../config.js";
import { IdentityPolicy } from "../identity/identity-policy.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";
import { principalHasProject } from "../identity/principal.js";
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
  principal?: AuthenticatedPrincipal | null;
}

/** Shared business boundary for GitHub Projects read operations. */
export class ProjectService {
  private readonly identity = new IdentityPolicy();

  constructor(private readonly options: ProjectServiceOptions) {}

  private assertOwnerScope(owner: string): void {
    if (this.options.principal && this.options.config.allowedOwners.length === 0) {
      throw new Error(
        "OWNER_ALLOWLIST_REQUIRED: Authenticated Project access requires an explicit server owner allowlist.",
      );
    }
    if (this.options.principal && this.options.config.allowedProjectIds.length === 0) {
      throw new Error(
        "PROJECT_ALLOWLIST_REQUIRED: Authenticated Project access requires an explicit server Project allowlist.",
      );
    }
    assertOwnerAllowed(this.options.config, owner);
  }

  private assertPrincipalRead(projectId: string): void {
    const principal = this.options.principal ?? null;
    if (!principal) return;
    this.identity.assertPermission(principal, "project.read");
    this.identity.assertProjectMembership(principal, projectId);
  }

  async listProjects(owner: string, first = 20): Promise<unknown[]> {
    this.assertOwnerScope(owner);
    const projects = await listProjects(this.options.client, owner, first);

    return projects.filter((project) => {
      let projectId: string;
      try {
        projectId = projectIdOf(project);
      } catch {
        return false;
      }

      if (
        this.options.config.allowedProjectIds.length > 0 &&
        !this.options.config.allowedProjectIds.includes(projectId)
      ) return false;

      const principal = this.options.principal ?? null;
      if (!principal) return true;
      if (!principal.permissions.includes("project.read")) return false;
      return principalHasProject(principal, projectId);
    });
  }

  async resolveProject(owner: string, number: number): Promise<unknown> {
    this.assertOwnerScope(owner);
    const project = await getProject(this.options.client, owner, number);
    const projectId = projectIdOf(project);
    assertProjectAllowed(this.options.config, projectId);
    this.assertPrincipalRead(projectId);
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
