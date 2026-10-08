/**
 * M11 provider-facing read contract.
 *
 * Keep identifiers provider-scoped: GitHub ProjectV2 node IDs must not
 * be treated as Jira project IDs. No permissions are granted here.
 * Authorization stays in the backing service.
 */
export type ProviderId = "github_projects" | "jira";

export interface ProjectLocator {
  provider: ProviderId;
  owner: string;
  number: number;
}

export interface ProjectProvider {
  readonly id: ProviderId;
  listProjects(owner: string, first?: number): Promise<unknown[]>;
  getProject(owner: string, number: number): Promise<unknown>;
  listFields(owner: string, number: number): Promise<unknown[]>;
  listItems(owner: string, number: number, first?: number): Promise<unknown[]>;
  getSnapshot(owner: string, number: number, first?: number): Promise<unknown>;
}
