import { z } from "zod";

import { GitHubGraphQlClient } from "./graphql-client.js";

const id = z.string().min(1).max(256);
const repository = z.object({
  nameWithOwner: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
});
const issueOrPullRequest = {
  id,
  number: z.number().int().positive(),
  title: z.string().max(1024),
  url: z.string().url().max(2048),
  repository,
};
const content = z.discriminatedUnion("__typename", [
  z.object({ __typename: z.literal("Issue"), ...issueOrPullRequest }),
  z.object({ __typename: z.literal("PullRequest"), ...issueOrPullRequest }),
  z.object({ __typename: z.literal("DraftIssue"), id, title: z.string().max(1024) }),
]);
const item = z.object({ id, type: z.string().max(100).nullable(), content: content.nullable() });
const page = z.object({
  node: z.object({
    __typename: z.literal("ProjectV2"),
    id,
    items: z.object({
      nodes: z.array(item).max(100),
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: id.nullable() }),
    }),
  }),
});

export type ProjectItemReferenceInventoryItem = z.infer<typeof item>;

export interface ProjectItemReferenceInventory {
  items: ProjectItemReferenceInventoryItem[];
  coverage: {
    pagesScanned: number;
    scannedItems: number;
    inaccessibleItems: number;
    hasNextPage: boolean;
    complete: boolean;
    maxItems: number;
  };
}

function parsePage(value: unknown): z.infer<typeof page> {
  const parsed = page.safeParse(value);
  if (!parsed.success) {
    throw new Error("PROJECT_ITEM_REFERENCE_RESPONSE_INVALID: GitHub returned malformed Project item data.");
  }
  return parsed.data;
}

/** Bounded inventory read by already-authorized Project node ID. */
export async function readProjectItemReferenceInventory(
  client: GitHubGraphQlClient,
  projectId: string,
): Promise<ProjectItemReferenceInventory> {
  const items: ProjectItemReferenceInventoryItem[] = [];
  const itemIds = new Set<string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let inaccessibleItems = 0;

  for (let pageNumber = 1; pageNumber <= 10; pageNumber++) {
    const data = parsePage(await client.request<unknown>(`
      query ProjectItemReferenceInventory($projectId: ID!, $after: String) {
        node(id: $projectId) { __typename ... on ProjectV2 {
          id
          items(first: 100, after: $after) {
            nodes {
              id type
              content {
                __typename
                ... on Issue { id number title url repository { nameWithOwner } }
                ... on PullRequest { id number title url repository { nameWithOwner } }
                ... on DraftIssue { id title }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        } }
      }`, { projectId, after }));

    if (data.node.id !== projectId) {
      throw new Error("PROJECT_ITEM_REFERENCE_RESPONSE_INVALID: GitHub returned a different Project.");
    }
    for (const node of data.node.items.nodes) {
      if (itemIds.has(node.id)) {
        throw new Error("PROJECT_ITEM_REFERENCE_RESPONSE_INVALID: GitHub returned a duplicate Project item.");
      }
      itemIds.add(node.id);
      if (node.content === null) inaccessibleItems++;
      items.push(node);
    }

    const info = data.node.items.pageInfo;
    if (info.hasNextPage && (!info.endCursor || cursors.has(info.endCursor) || data.node.items.nodes.length === 0)) {
      throw new Error("PROJECT_ITEM_REFERENCE_RESPONSE_INVALID: GitHub returned invalid Project pagination.");
    }
    if (!info.hasNextPage || pageNumber === 10) {
      return {
        items,
        coverage: {
          pagesScanned: pageNumber,
          scannedItems: items.length,
          inaccessibleItems,
          hasNextPage: info.hasNextPage,
          complete: !info.hasNextPage,
          maxItems: 1000,
        },
      };
    }
    after = info.endCursor;
    cursors.add(after!);
  }

  throw new Error("PROJECT_ITEM_REFERENCE_RESPONSE_INVALID: Project inventory pagination failed.");
}
