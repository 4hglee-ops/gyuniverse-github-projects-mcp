import { GitHubGraphQlClient } from "./graphql-client.js";

interface ProjectItemContent {
  __typename?: string;
  id?: string;
  number?: number;
  title?: string;
  url?: string;
  repository?: { nameWithOwner?: string } | null;
}

interface ProjectItemNode {
  id?: string;
  type?: string;
  isArchived?: boolean;
  content?: ProjectItemContent | null;
}

interface ProjectItemPage {
  repositoryOwner?: {
    projectV2?: {
      id: string;
      number: number;
      title: string;
      items: {
        totalCount: number;
        pageInfo: {
          hasNextPage: boolean;
          endCursor?: string | null;
        };
        nodes?: Array<ProjectItemNode | null> | null;
      };
    } | null;
  } | null;
}

export interface ProjectItemResolution {
  project: {
    id: string;
    number: number;
    title: string;
  };
  contentId: string;
  found: boolean;
  item: {
    itemId: string;
    itemType: string | null;
    archived: boolean;
    contentType: string | null;
    repository: string | null;
    number: number | null;
    title: string | null;
    url: string | null;
  } | null;
  totalProjectItems: number;
  scannedItems: number;
  pagesScanned: number;
  searchExhaustive: boolean;
}

const PROJECT_ITEM_PAGE_QUERY = `
  query($login: String!, $number: Int!, $after: String) {
    repositoryOwner(login: $login) {
      ... on Organization {
        projectV2(number: $number) {
          id
          number
          title
          items(first: 100, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              type
              isArchived
              content {
                __typename
                ... on Issue {
                  id
                  number
                  title
                  url
                  repository { nameWithOwner }
                }
                ... on PullRequest {
                  id
                  number
                  title
                  url
                  repository { nameWithOwner }
                }
              }
            }
          }
        }
      }
      ... on User {
        projectV2(number: $number) {
          id
          number
          title
          items(first: 100, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              type
              isArchived
              content {
                __typename
                ... on Issue {
                  id
                  number
                  title
                  url
                  repository { nameWithOwner }
                }
                ... on PullRequest {
                  id
                  number
                  title
                  url
                  repository { nameWithOwner }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function findProjectItemByContentId(
  client: GitHubGraphQlClient,
  owner: string,
  projectNumber: number,
  contentId: string,
  maxPages = 100,
): Promise<ProjectItemResolution> {
  let after: string | null = null;
  let scannedItems = 0;
  let pagesScanned = 0;
  let totalProjectItems = 0;
  let projectMetadata: ProjectItemResolution["project"] | null = null;

  while (pagesScanned < maxPages) {
    const data: ProjectItemPage = await client.request<ProjectItemPage>(
      PROJECT_ITEM_PAGE_QUERY,
      { login: owner, number: projectNumber, after },
    );

    const project = data.repositoryOwner?.projectV2;
    if (!project) {
      throw new Error(`GitHub Project #${projectNumber} was not found or is not accessible.`);
    }

    projectMetadata ??= {
      id: project.id,
      number: project.number,
      title: project.title,
    };

    pagesScanned += 1;
    totalProjectItems = project.items.totalCount;

    const nodes = (project.items.nodes ?? []).filter(
      (node): node is ProjectItemNode => Boolean(node),
    );
    scannedItems += nodes.length;

    const match = nodes.find((node) => node.content?.id === contentId);
    if (match?.id) {
      const content = match.content ?? null;
      return {
        project: projectMetadata,
        contentId,
        found: true,
        item: {
          itemId: match.id,
          itemType: match.type ?? null,
          archived: match.isArchived ?? false,
          contentType: content?.__typename ?? null,
          repository: content?.repository?.nameWithOwner ?? null,
          number: content?.number ?? null,
          title: content?.title ?? null,
          url: content?.url ?? null,
        },
        totalProjectItems,
        scannedItems,
        pagesScanned,
        searchExhaustive: !project.items.pageInfo.hasNextPage,
      };
    }

    if (!project.items.pageInfo.hasNextPage) {
      return {
        project: projectMetadata,
        contentId,
        found: false,
        item: null,
        totalProjectItems,
        scannedItems,
        pagesScanned,
        searchExhaustive: true,
      };
    }

    const endCursor = project.items.pageInfo.endCursor;
    if (!endCursor) {
      throw new Error("GitHub Project item pagination reported another page without an end cursor.");
    }
    after = endCursor;
  }

  if (!projectMetadata) {
    throw new Error(`GitHub Project #${projectNumber} could not be read.`);
  }

  return {
    project: projectMetadata,
    contentId,
    found: false,
    item: null,
    totalProjectItems,
    scannedItems,
    pagesScanned,
    searchExhaustive: false,
  };
}
