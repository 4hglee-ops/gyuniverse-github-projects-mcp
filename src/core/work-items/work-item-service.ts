import { type AppConfig, assertOwnerAllowed } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { findProjectItemByContentId } from "../../github/project-items.js";
import {
  parseGitHubIssueOrPullRequestUrl,
  resolveGitHubIssueOrPullRequest,
  type ResolvedGitHubWorkItem,
} from "../../github/references.js";

export interface WorkItemProjectReader {
  resolveProject(owner: string, number: number): Promise<unknown>;
}

export interface WorkItemServiceOptions {
  config: AppConfig;
  client: GitHubGraphQlClient;
  projects: WorkItemProjectReader;
}

/**
 * Shared domain boundary for resolving GitHub Issues / Pull Requests and their
 * membership in an allowed GitHub Project.
 *
 * Transport adapters should not duplicate URL parsing, repository-owner checks,
 * Project allowlist checks, or Project-item pagination.
 */
export class WorkItemService {
  constructor(private readonly options: WorkItemServiceOptions) {}

  async resolveWorkItemUrl(url: string): Promise<ResolvedGitHubWorkItem> {
    const parsed = parseGitHubIssueOrPullRequestUrl(url);
    assertOwnerAllowed(this.options.config, parsed.owner);
    return resolveGitHubIssueOrPullRequest(this.options.client, url);
  }

  async resolveProjectItem(
    projectOwner: string,
    projectNumber: number,
    url: string,
  ) {
    const resolvedContent = await this.resolveWorkItemUrl(url);
    await this.options.projects.resolveProject(projectOwner, projectNumber);

    const projectItem = await findProjectItemByContentId(
      this.options.client,
      projectOwner,
      projectNumber,
      resolvedContent.contentId,
    );

    return { resolvedContent, projectItem };
  }
}
