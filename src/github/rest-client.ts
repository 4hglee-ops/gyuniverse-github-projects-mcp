export type GitHubRestMethod = "GET" | "POST";

export interface GitHubRestClientOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
}

export class GitHubRestClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(
    private readonly token: string,
    options: GitHubRestClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async request<T>(method: GitHubRestMethod, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "gyuniverse-github-projects-mcp",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 2_000);
      throw new Error(`GitHub REST request failed (${response.status}): ${responseBody}`);
    }

    return await response.json() as T;
  }
}
