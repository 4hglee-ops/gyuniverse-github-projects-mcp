import type { ProjectService } from "../../core/projects/project-service.js";
import type { ProjectProvider } from "../provider.js";

/**
 * Compatibility adapter for the existing ProjectService.
 *
 * Deliberately delegates every read to ProjectService, preserving owner
 * allowlists, project allowlists, principal membership and capability checks.
 * Existing MCP and REST routes are left unchanged in M11 phase one.
 */
export class GitHubProjectsProvider implements ProjectProvider {
  readonly id = "github_projects" as const;

  constructor(private readonly projects: Pick<ProjectService,
    "listProjects" | "resolveProject" | "listProjectFields" |
    "listProjectItems" | "getProjectSnapshot">) {}

  listProjects(owner: string, first = 20): Promise<unknown[]> {
    return this.projects.listProjects(owner, first);
  }

  getProject(owner: string, number: number): Promise<unknown> {
    return this.projects.resolveProject(owner, number);
  }

  listFields(owner: string, number: number): Promise<unknown[]> {
    return this.projects.listProjectFields(owner, number);
  }

  listItems(owner: string, number: number, first = 50): Promise<unknown[]> {
    return this.projects.listProjectItems(owner, number, first);
  }

  getSnapshot(owner: string, number: number, first = 100): Promise<unknown> {
    return this.projects.getProjectSnapshot(owner, number, first);
  }
}
