import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { addItemToProject } from "../github/projects.js";
import type { ProjectItemResolution } from "../github/project-items.js";
import {
  updateProjectSingleSelectByName,
  type NamedSingleSelectUpdateInput,
  type NamedSingleSelectUpdateResult,
} from "./single-select-update.js";

export interface CaptureBacklogWorkItemReader {
  resolveProjectItem(
    projectOwner: string,
    projectNumber: number,
    url: string,
  ): Promise<{
    resolvedContent: { contentId: string; title: string; url: string; repositoryWithOwner: string };
    projectItem: ProjectItemResolution;
  }>;
}

export interface CaptureBacklogInput {
  owner: string;
  projectNumber: number;
  projectId: string;
  url: string;
}

export interface CaptureBacklogResult {
  changed: boolean;
  verified: boolean;
  addedToProject: boolean;
  itemId: string;
  content: {
    id: string;
    title: string;
    url: string;
    repository: string;
  };
  status: NamedSingleSelectUpdateResult;
  mutationSkippedReason: string | null;
}

type AddItem = (
  client: GitHubGraphQlClient,
  projectId: string,
  contentId: string,
) => Promise<unknown>;

type UpdateNamedSingleSelect = (
  client: GitHubGraphQlClient,
  input: NamedSingleSelectUpdateInput,
) => Promise<NamedSingleSelectUpdateResult>;

export interface CaptureBacklogDependencies {
  addItem?: AddItem;
  updateNamedSingleSelect?: UpdateNamedSingleSelect;
}

export async function captureProjectBacklogItem(
  client: GitHubGraphQlClient,
  workItems: CaptureBacklogWorkItemReader,
  input: CaptureBacklogInput,
  dependencies: CaptureBacklogDependencies = {},
): Promise<CaptureBacklogResult> {
  const addItem = dependencies.addItem ?? addItemToProject;
  const updateNamedSingleSelect = dependencies.updateNamedSingleSelect ?? updateProjectSingleSelectByName;

  const initial = await workItems.resolveProjectItem(input.owner, input.projectNumber, input.url);
  if (initial.projectItem.project.id !== input.projectId) {
    throw new Error(
      `PROJECT_ITEM_PROJECT_MISMATCH: Project lookup resolved '${initial.projectItem.project.id}', not '${input.projectId}'.`,
    );
  }

  let addedToProject = false;
  let itemId = initial.projectItem.item?.itemId ?? null;

  if (!initial.projectItem.found) {
    if (!initial.projectItem.searchExhaustive) {
      throw new Error("PROJECT_ITEM_LOOKUP_INCOMPLETE: Cannot safely capture because Project item lookup was not exhaustive.");
    }

    await addItem(client, input.projectId, initial.resolvedContent.contentId);
    addedToProject = true;

    const verifiedMembership = await workItems.resolveProjectItem(input.owner, input.projectNumber, input.url);
    if (!verifiedMembership.projectItem.found || !verifiedMembership.projectItem.item?.itemId) {
      throw new Error("MUTATION_VERIFICATION_FAILED: Work item was not found in the Project after add.");
    }
    if (verifiedMembership.projectItem.project.id !== input.projectId) {
      throw new Error("MUTATION_VERIFICATION_FAILED: Captured work item resolved to a different Project.");
    }
    itemId = verifiedMembership.projectItem.item.itemId;
  }

  if (!itemId) {
    throw new Error("PROJECT_ITEM_NOT_FOUND: Work item does not have a Project item ID.");
  }

  const status = await updateNamedSingleSelect(client, {
    owner: input.owner,
    projectNumber: input.projectNumber,
    projectId: input.projectId,
    itemId,
    fieldName: "Status",
    optionName: "Backlog",
  });

  const changed = addedToProject || status.changed;
  return {
    changed,
    verified: status.verified,
    addedToProject,
    itemId,
    content: {
      id: initial.resolvedContent.contentId,
      title: initial.resolvedContent.title,
      url: initial.resolvedContent.url,
      repository: initial.resolvedContent.repositoryWithOwner,
    },
    status,
    mutationSkippedReason: changed ? null : "already_captured_in_backlog",
  };
}
