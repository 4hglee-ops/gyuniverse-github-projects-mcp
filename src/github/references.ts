import { GitHubGraphQlClient } from "./graphql-client.js";

export type GitHubWorkItemKind = "issue" | "pull_request";

export interface ParsedGitHubWorkItemUrl {
  kind: GitHubWorkItemKind;
  owner: string;
  repository: string;
  number: number;
  canonicalUrl: string;
}

export interface ResolvedGitHubWorkItem extends ParsedGitHubWorkItemUrl {
  contentId: string;
  repositoryWithOwner: string;
  title: string;
  url: string;
  state: string;
  merged: boolean | null;
}

const OWNER_OR_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function parseGitHubIssueOrPullRequestUrl(rawUrl: string): ParsedGitHubWorkItemUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("A valid absolute GitHub Issue or Pull Request URL is required.");
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only https://github.com Issue and Pull Request URLs are supported.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 4) {
    throw new Error("Expected a GitHub URL shaped like /<owner>/<repo>/issues/<number> or /<owner>/<repo>/pull/<number>.");
  }

  const [owner, repository, typeSegment, numberSegment] = segments;
  if (!owner || !repository || !OWNER_OR_REPO_PATTERN.test(owner) || !OWNER_OR_REPO_PATTERN.test(repository)) {
    throw new Error("GitHub repository owner or name is invalid.");
  }

  const kind: GitHubWorkItemKind = typeSegment === "issues"
    ? "issue"
    : typeSegment === "pull"
      ? "pull_request"
      : (() => {
          throw new Error("URL must point to a GitHub Issue or Pull Request.");
        })();

  if (!numberSegment || !/^\d+$/.test(numberSegment)) {
    throw new Error("GitHub Issue or Pull Request number must be a positive integer.");
  }

  const number = Number(numberSegment);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("GitHub Issue or Pull Request number must be a positive integer.");
  }

  const canonicalUrl = kind === "issue"
    ? `https://github.com/${owner}/${repository}/issues/${number}`
    : `https://github.com/${owner}/${repository}/pull/${number}`;

  return { kind, owner, repository, number, canonicalUrl };
}

interface IssueEnvelope {
  repository?: {
    issue?: {
      id: string;
      number: number;
      title: string;
      url: string;
      state: string;
      repository: { nameWithOwner: string };
    } | null;
  } | null;
}

interface PullRequestEnvelope {
  repository?: {
    pullRequest?: {
      id: string;
      number: number;
      title: string;
      url: string;
      state: string;
      merged: boolean;
      repository: { nameWithOwner: string };
    } | null;
  } | null;
}

export async function resolveGitHubIssueOrPullRequest(
  client: GitHubGraphQlClient,
  rawUrl: string,
): Promise<ResolvedGitHubWorkItem> {
  const parsed = parseGitHubIssueOrPullRequestUrl(rawUrl);

  if (parsed.kind === "issue") {
    const data = await client.request<IssueEnvelope>(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            id
            number
            title
            url
            state
            repository { nameWithOwner }
          }
        }
      }`,
      { owner: parsed.owner, name: parsed.repository, number: parsed.number },
    );

    const issue = data.repository?.issue;
    if (!issue) {
      throw new Error(`GitHub Issue was not found or is not accessible: ${parsed.canonicalUrl}`);
    }

    return {
      ...parsed,
      contentId: issue.id,
      repositoryWithOwner: issue.repository.nameWithOwner,
      title: issue.title,
      url: issue.url,
      state: issue.state,
      merged: null,
    };
  }

  const data = await client.request<PullRequestEnvelope>(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          id
          number
          title
          url
          state
          merged
          repository { nameWithOwner }
        }
      }
    }`,
    { owner: parsed.owner, name: parsed.repository, number: parsed.number },
  );

  const pullRequest = data.repository?.pullRequest;
  if (!pullRequest) {
    throw new Error(`GitHub Pull Request was not found or is not accessible: ${parsed.canonicalUrl}`);
  }

  return {
    ...parsed,
    contentId: pullRequest.id,
    repositoryWithOwner: pullRequest.repository.nameWithOwner,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state,
    merged: pullRequest.merged,
  };
}
