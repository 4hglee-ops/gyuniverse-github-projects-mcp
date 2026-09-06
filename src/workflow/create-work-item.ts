import { GitHubGraphQlClient } from "../github/graphql-client.js";

export interface CreateIssueInput {
  owner: string;
  repository: string;
  title: string;
  body?: string | null;
}

export interface CreatedIssue {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: string;
}

interface RepositoryEnvelope {
  repository?: {
    id?: string | null;
    nameWithOwner?: string | null;
  } | null;
}

interface CreateIssueEnvelope {
  createIssue?: {
    issue?: {
      id?: string | null;
      number?: number | null;
      title?: string | null;
      url?: string | null;
      repository?: { nameWithOwner?: string | null } | null;
    } | null;
  } | null;
}

export async function createGitHubIssue(
  client: GitHubGraphQlClient,
  input: CreateIssueInput,
): Promise<CreatedIssue> {
  const repositoryData = await client.request<RepositoryEnvelope>(
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) { id nameWithOwner }
    }`,
    { owner: input.owner, name: input.repository },
  );

  const repositoryId = repositoryData.repository?.id;
  const repositoryName = repositoryData.repository?.nameWithOwner;
  if (!repositoryId || !repositoryName) {
    throw new Error(`REPOSITORY_NOT_FOUND: '${input.owner}/${input.repository}' is not accessible.`);
  }

  const data = await client.request<CreateIssueEnvelope>(
    `mutation($repositoryId: ID!, $title: String!, $body: String) {
      createIssue(input: { repositoryId: $repositoryId, title: $title, body: $body }) {
        issue { id number title url repository { nameWithOwner } }
      }
    }`,
    {
      repositoryId,
      title: input.title,
      body: input.body ?? null,
    },
  );

  const issue = data.createIssue?.issue;
  if (
    !issue?.id ||
    typeof issue.number !== "number" ||
    !issue.title ||
    !issue.url ||
    !issue.repository?.nameWithOwner
  ) {
    throw new Error("MUTATION_VERIFICATION_FAILED: GitHub did not return a complete created Issue.");
  }

  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    repository: issue.repository.nameWithOwner,
  };
}
