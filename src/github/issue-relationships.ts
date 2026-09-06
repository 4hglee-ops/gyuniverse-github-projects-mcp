import { z } from "zod";
import { GitHubGraphQlClient } from "./graphql-client.js";

const id = z.string().min(1).max(256);
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: id.nullable() });
const issue = z.object({
  __typename: z.literal("Issue"), id,
  number: z.number().int().positive(), title: z.string().max(1024),
  url: z.string().url().max(2048), state: z.enum(["OPEN", "CLOSED"]),
  repository: z.object({ nameWithOwner: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/) }),
}).refine((value) => value.url === `https://github.com/${value.repository.nameWithOwner}/issues/${value.number}`);
const item = z.object({
  id,
  content: z.discriminatedUnion("__typename", [issue,
    z.object({ __typename: z.literal("PullRequest") }),
    z.object({ __typename: z.literal("DraftIssue") }),
  ]).nullable(),
});
const inventorySchema = z.object({ node: z.object({
  __typename: z.literal("ProjectV2"), id,
  items: z.object({ nodes: z.array(item).max(100), pageInfo }),
}) });
const connection = z.object({
  nodes: z.array(z.object({ id })).max(100),
  totalCount: z.number().int().nonnegative(), pageInfo,
}).superRefine((value, ctx) => {
  if (value.nodes.length > value.totalCount ||
      new Set(value.nodes.map((node) => node.id)).size !== value.nodes.length ||
      (value.pageInfo.hasNextPage && (!value.pageInfo.endCursor || value.nodes.length === 0 || value.totalCount <= value.nodes.length)) ||
      (!value.pageInfo.hasNextPage && value.totalCount !== value.nodes.length)) {
    ctx.addIssue({ code: "custom", message: "Inconsistent relationship coverage" });
  }
});
const relationshipsSchema = z.object({ node: z.object({
  __typename: z.literal("Issue"), id,
  parent: z.object({ id }).nullable(),
  subIssues: connection, blocking: connection, blockedBy: connection,
}) });

export type ProjectRelationshipItem = z.infer<typeof item>;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("RELATIONSHIP_RESPONSE_INVALID: GitHub returned malformed relationship data.");
  return result.data;
}

/** Read only IDs for related Issues; detail comes exclusively from the authorized Project. */
export async function readIssueRelationships(client: GitHubGraphQlClient, issueId: string, first: number) {
  const data = parse(relationshipsSchema, await client.request<unknown>(`
    query IssueRelationships($issueId: ID!, $first: Int!) {
      node(id: $issueId) { __typename ... on Issue {
        id parent { id }
        subIssues(first: $first) { nodes { id } totalCount pageInfo { hasNextPage endCursor } }
        blocking(first: $first) { nodes { id } totalCount pageInfo { hasNextPage endCursor } }
        blockedBy(first: $first) { nodes { id } totalCount pageInfo { hasNextPage endCursor } }
      } }
    }`, { issueId, first }));
  if (data.node.id !== issueId || [data.node.subIssues, data.node.blocking, data.node.blockedBy].some((value) => value.nodes.length > first)) {
    throw new Error("RELATIONSHIP_RESPONSE_INVALID: Unexpected Issue or result bound.");
  }
  return data.node;
}

/** Bounded Project membership inventory, never an arbitrary repository lookup. */
export async function readRelationshipProjectItems(client: GitHubGraphQlClient, projectId: string) {
  const items: ProjectRelationshipItem[] = [];
  const seenItems = new Set<string>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let inaccessibleItems = 0;
  for (let page = 1; page <= 10; page++) {
    const data: z.infer<typeof inventorySchema> = parse(inventorySchema, await client.request<unknown>(`
      query RelationshipProjectItems($projectId: ID!, $after: String) {
        node(id: $projectId) { __typename ... on ProjectV2 {
          id items(first: 100, after: $after) {
            nodes { id content { __typename ... on Issue {
              id number title url state repository { nameWithOwner }
            } } }
            pageInfo { hasNextPage endCursor }
          }
        } }
      }`, { projectId, after }));
    if (data.node.id !== projectId) throw new Error("RELATIONSHIP_RESPONSE_INVALID: Unexpected Project.");
    const { nodes, pageInfo: info } = data.node.items;
    for (const node of nodes) {
      if (seenItems.has(node.id)) throw new Error("RELATIONSHIP_RESPONSE_INVALID: Duplicate Project item.");
      seenItems.add(node.id);
      if (node.content === null) inaccessibleItems++;
      items.push(node);
    }
    if (info.hasNextPage && (!info.endCursor || cursors.has(info.endCursor) || nodes.length === 0)) {
      throw new Error("RELATIONSHIP_RESPONSE_INVALID: Invalid Project pagination.");
    }
    if (!info.hasNextPage || page === 10) return {
      items, coverage: { pagesScanned: page, scannedItems: items.length, inaccessibleItems,
        hasNextPage: info.hasNextPage, complete: !info.hasNextPage && inaccessibleItems === 0, maxItems: 1000 },
    };
    after = info.endCursor;
    cursors.add(after!);
  }
  throw new Error("RELATIONSHIP_RESPONSE_INVALID");
}
