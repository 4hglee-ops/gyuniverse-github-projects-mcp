export interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class GitHubGraphQlClient {
  constructor(private readonly token: string) {}

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "gyuniverse-github-projects-mcp",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub GraphQL request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as GraphQlResponse<T>;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }
    if (!payload.data) {
      throw new Error("GitHub GraphQL response did not contain data.");
    }
    return payload.data;
  }
}
