import { z } from "zod";
import { type AppConfig, assertOwnerAllowed } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { readIssueRelationships, readRelationshipProjectItems, type ProjectRelationshipItem } from "../../github/issue-relationships.js";
import { projectIdOf, type ProjectService } from "../projects/project-service.js";

export const relationshipInputSchema = z.object({
  owner: z.string().min(1).max(100), number: z.number().int().positive(),
  itemId: z.string().min(1).max(256),
  first: z.number().int().min(1).max(100).default(50),
});
type IssueItem = ProjectRelationshipItem & { content: Extract<NonNullable<ProjectRelationshipItem["content"]>, { __typename: "Issue" }> };

function isIssue(item: ProjectRelationshipItem): item is IssueItem { return item.content?.__typename === "Issue"; }
function normalized(item: IssueItem) {
  return { itemId: item.id, contentId: item.content.id, contentType: "Issue" as const,
    repository: item.content.repository.nameWithOwner, number: item.content.number,
    title: item.content.title, url: item.content.url, state: item.content.state,
    insideAuthorizedProject: true as const };
}

export class ProjectRelationshipService {
  constructor(private readonly options: {
    config: AppConfig; client: GitHubGraphQlClient; projects: Pick<ProjectService, "resolveProject">;
  }) {}

  async getRelationships(input: z.input<typeof relationshipInputSchema>) {
    const { owner, number, itemId, first } = relationshipInputSchema.parse(input);
    // Resolve through the same owner/Project/principal boundary as existing reads, BEFORE content queries.
    const projectId = projectIdOf(await this.options.projects.resolveProject(owner, number));
    const inventory = await readRelationshipProjectItems(this.options.client, projectId);
    const source = inventory.items.find((item) => item.id === itemId);
    if (!source) throw new Error(inventory.coverage.complete ? "PROJECT_ITEM_NOT_FOUND" : "PROJECT_ITEM_LOOKUP_INCOMPLETE");
    if (source.content === null) throw new Error("PROJECT_ITEM_CONTENT_INACCESSIBLE");
    if (!isIssue(source)) throw new Error("RELATIONSHIP_SOURCE_UNSUPPORTED: Only GitHub Issue Project items are supported.");
    assertOwnerAllowed(this.options.config, source.content.repository.nameWithOwner.split("/")[0]!);
    const byContent = new Map(inventory.items.filter(isIssue).map((item) => [item.content.id, item]));
    const relationships = await readIssueRelationships(this.options.client, source.content.id, first);
    const group = (ids: string[], totalCount: number, hasNextPage: boolean) => {
      const targets: ReturnType<typeof normalized>[] = [];
      const withheld = { outsideProject: 0, membershipUnverified: 0, repositoryOwnerNotAllowed: 0 };
      for (const id of ids) {
        const target = byContent.get(id);
        if (!target) {
          if (inventory.coverage.complete) withheld.outsideProject++;
          else withheld.membershipUnverified++;
          continue;
        }
        try { assertOwnerAllowed(this.options.config, target.content.repository.nameWithOwner.split("/")[0]!); }
        catch { withheld.repositoryOwnerNotAllowed++; continue; }
        targets.push(normalized(target));
      }
      return { targets, coverage: { totalCount, fetchedCount: ids.length, returnedCount: targets.length,
        withheld, hasNextPage, complete: !hasNextPage && targets.length === totalCount } };
    };
    const fromConnection = (value: typeof relationships.subIssues) => group(value.nodes.map((node) => node.id), value.totalCount, value.pageInfo.hasNextPage);
    return {
      project: { id: projectId, owner, number }, source: normalized(source),
      parent: group(relationships.parent ? [relationships.parent.id] : [], relationships.parent ? 1 : 0, false),
      subIssues: fromConnection(relationships.subIssues), blocks: fromConnection(relationships.blocking),
      blockedBy: fromConnection(relationships.blockedBy),
      coverage: { projectInventory: inventory.coverage, firstPerRelationship: first, scope: "same_authorized_project" as const },
      evidencePolicy: "Native GitHub Issue relationships only. blocks means source blocks target; blockedBy means source is blocked by target. Relationships include open and closed Issues and do not alone prove an active blocker. Reads are not an atomic snapshot. Missing or withheld details are not evidence of no relationship.",
    };
  }
}
