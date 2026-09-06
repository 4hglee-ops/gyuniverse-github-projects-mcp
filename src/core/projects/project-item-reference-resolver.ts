import { z } from "zod";

import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import {
  readProjectItemReferenceInventory,
  type ProjectItemReferenceInventory,
  type ProjectItemReferenceInventoryItem,
} from "../../github/project-item-references.js";
import { projectIdOf, type ProjectService } from "./project-service.js";

const repositoryName = z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(201);

export const projectItemReferenceSchema = z.object({
  itemId: z.string().trim().min(1).max(256).optional(),
  url: z.string().trim().url().max(2048).optional(),
  repository: repositoryName.optional(),
  number: z.number().int().positive().optional(),
}).strict();

export type ProjectItemReference = z.infer<typeof projectItemReferenceSchema>;

export interface ResolvedAuthorizedProjectItem {
  itemId: string;
  itemType: string | null;
  contentType: "Issue" | "PullRequest" | "DraftIssue" | null;
  contentId: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
}

export interface AuthorizedProjectItemResolution {
  owner: string;
  projectNumber: number;
  projectId: string;
  items: ResolvedAuthorizedProjectItem[];
}

type IssueOrPullRequest = ProjectItemReferenceInventoryItem & {
  content: Extract<NonNullable<ProjectItemReferenceInventoryItem["content"]>, { __typename: "Issue" | "PullRequest" }>;
};

function fail(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function referenceKind(reference: ProjectItemReference): "itemId" | "url" | "repositoryNumber" | "number" {
  const supplied = [reference.itemId !== undefined, reference.url !== undefined,
    reference.repository !== undefined, reference.number !== undefined].filter(Boolean).length;
  if (reference.itemId) {
    if (supplied !== 1) fail("PROJECT_ITEM_REFERENCE_INVALID", "itemId cannot be combined with another reference form.");
    return "itemId";
  }
  if (reference.url) {
    if (supplied !== 1) fail("PROJECT_ITEM_REFERENCE_INVALID", "url cannot be combined with another reference form.");
    return "url";
  }
  if (reference.repository) {
    if (!reference.number || supplied !== 2) {
      fail("PROJECT_ITEM_REFERENCE_INVALID", "repository requires exactly one Issue or pull request number.");
    }
    return "repositoryNumber";
  }
  if (reference.number && supplied === 1) return "number";
  fail("PROJECT_ITEM_REFERENCE_INVALID", "Provide itemId, an Issue/pull request URL, repository plus number, or a unique number.");
}

function issueOrPullRequest(item: ProjectItemReferenceInventoryItem): item is IssueOrPullRequest {
  return item.content?.__typename === "Issue" || item.content?.__typename === "PullRequest";
}

function parseGitHubUrl(value: string): { repository: string; number: number; contentType: "Issue" | "PullRequest" } {
  let url: URL;
  try { url = new URL(value); }
  catch { fail("PROJECT_ITEM_REFERENCE_INVALID", "URL must identify a GitHub Issue or pull request."); }
  const parts = url.pathname.split("/").filter(Boolean);
  const rawNumber = parts[3];
  const number = rawNumber && /^\d+$/.test(rawNumber) ? Number(rawNumber) : 0;
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" ||
      parts.length !== 4 || !["issues", "pull"].includes(parts[2] ?? "") || !Number.isSafeInteger(number) || number < 1 ||
      url.search || url.hash) {
    fail("PROJECT_ITEM_REFERENCE_INVALID", "URL must be a canonical GitHub Issue or pull request URL.");
  }
  return {
    repository: `${parts[0]}/${parts[1]}`,
    number,
    contentType: parts[2] === "issues" ? "Issue" : "PullRequest",
  };
}

function resolved(item: ProjectItemReferenceInventoryItem): ResolvedAuthorizedProjectItem {
  const content = item.content;
  return {
    itemId: item.id,
    itemType: item.type,
    contentType: content?.__typename ?? null,
    contentId: content?.id ?? null,
    repository: issueOrPullRequest(item) ? item.content.repository.nameWithOwner : null,
    number: issueOrPullRequest(item) ? item.content.number : null,
    title: content?.title ?? null,
    url: issueOrPullRequest(item) ? item.content.url : null,
  };
}

/**
 * Resolves references only after ProjectService has enforced owner allowlist,
 * Project allowlist, project.read and authenticated Project membership.
 */
export class AuthorizedProjectItemReferenceResolver {
  constructor(private readonly options: {
    config: AppConfig;
    client: GitHubGraphQlClient;
    projects: Pick<ProjectService, "resolveProject">;
    inventory?: (client: GitHubGraphQlClient, projectId: string) => Promise<ProjectItemReferenceInventory>;
  }) {}

  async resolveMany(
    ownerInput: string | undefined,
    projectNumber: number,
    references: ProjectItemReference[],
  ): Promise<AuthorizedProjectItemResolution> {
    if (!Number.isInteger(projectNumber) || projectNumber < 1) {
      fail("PROJECT_ITEM_REFERENCE_INVALID", "Project number must be a positive integer.");
    }
    if (references.length < 1 || references.length > 20) {
      fail("PROJECT_ITEM_REFERENCE_INVALID", "Resolve between 1 and 20 Project item references at once.");
    }
    const parsed = references.map((reference) => {
      const result = projectItemReferenceSchema.safeParse(reference);
      if (!result.success) fail("PROJECT_ITEM_REFERENCE_INVALID", "Project item reference fields are invalid.");
      referenceKind(result.data);
      return result.data;
    });
    const owner = this.resolveOwner(ownerInput);
    const projectId = projectIdOf(await this.options.projects.resolveProject(owner, projectNumber));
    const inventory = await (this.options.inventory ?? readProjectItemReferenceInventory)(this.options.client, projectId);
    const items = parsed.map((reference) => this.resolveOne(reference, inventory));
    return { owner, projectNumber, projectId, items };
  }

  private resolveOwner(ownerInput: string | undefined): string {
    const owner = ownerInput?.trim();
    if (owner) return owner;
    const allowed = [...new Set(this.options.config.allowedOwners.map((value) => value.trim()).filter(Boolean))];
    if (allowed.length === 1) return allowed[0]!;
    fail("PROJECT_OWNER_REQUIRED", "Provide the Project owner because the authorized server context is not unambiguous.");
  }

  private resolveOne(
    reference: ProjectItemReference,
    inventory: ProjectItemReferenceInventory,
  ): ResolvedAuthorizedProjectItem {
    const kind = referenceKind(reference);
    let matches: ProjectItemReferenceInventoryItem[];
    if (kind === "itemId") {
      matches = inventory.items.filter((item) => item.id === reference.itemId);
      if (matches.length === 0 && !inventory.coverage.complete) {
        fail("PROJECT_ITEM_LOOKUP_INCOMPLETE", "Project membership could not be proven within the bounded inventory.");
      }
    } else {
      if (!inventory.coverage.complete || inventory.coverage.inaccessibleItems > 0) {
        fail("PROJECT_ITEM_LOOKUP_INCOMPLETE", "A friendly reference requires complete accessible Project item coverage.");
      }
      const candidates = inventory.items.filter(issueOrPullRequest);
      if (kind === "url") {
        const target = parseGitHubUrl(reference.url!);
        matches = candidates.filter((item) =>
          item.content.__typename === target.contentType &&
          item.content.number === target.number &&
          item.content.repository.nameWithOwner.toLowerCase() === target.repository.toLowerCase());
      } else if (kind === "repositoryNumber") {
        matches = candidates.filter((item) => item.content.number === reference.number &&
          item.content.repository.nameWithOwner.toLowerCase() === reference.repository!.toLowerCase());
      } else {
        matches = candidates.filter((item) => item.content.number === reference.number);
      }
    }
    if (matches.length === 0) {
      fail("PROJECT_ITEM_NOT_FOUND", "No matching item exists in the authorized Project.");
    }
    if (matches.length > 1) {
      fail("PROJECT_ITEM_REFERENCE_AMBIGUOUS", "More than one matching item exists in the authorized Project; provide an Issue/pull request URL or repository plus number.");
    }
    return resolved(matches[0]!);
  }
}
