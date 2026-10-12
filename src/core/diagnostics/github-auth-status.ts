import {
  type AuthenticatedPrincipal,
  principalHasProjectPermission,
} from "../identity/principal.js";

export type GitHubTokenState = "valid" | "invalid" | "rate_limited" | "unknown";

export interface GitHubAuthStatus {
  provider: "github";
  tokenStatus: GitHubTokenState;
  checkedAt: string;
  /** ProjectV2 permission is intentionally not inferred from a viewer query. */
  projectAccess: "not_checked";
}

type FetchResult = Pick<Response, "ok" | "status" | "headers" | "json">;
type Fetcher = (url: string, init: RequestInit) => Promise<FetchResult>;

const VIEWER_QUERY = "query GyuniverseAuthCheck { viewer { id } }";

/** Prevent viewers, unauthenticated callers and unscoped admins probing a shared server credential. */
export function assertGitHubAuthDiagnosticAllowed(principal: AuthenticatedPrincipal | null): void {
  if (!principal || principal.role !== "admin" ||
    !principal.projectIds.some(id => principalHasProjectPermission(principal, id, "project.read"))) {
    throw new Error("PERMISSION_DENIED: GitHub credential diagnostics require an authorized project admin.");
  }
}

/**
 * Performs a bounded, read-only request against GitHub GraphQL.
 * Never returns the credential, GitHub actor identity, raw error body or response headers.
 * A valid viewer probe does not establish access to any particular ProjectV2.
 */
export async function probeGitHubAuthToken(
  githubToken: string,
  fetcher: Fetcher = fetch,
): Promise<GitHubAuthStatus> {
  const result = (tokenStatus: GitHubTokenState): GitHubAuthStatus => ({
    provider: "github",
    tokenStatus,
    checkedAt: new Date().toISOString(),
    projectAccess: "not_checked",
  });
  if (!githubToken.trim()) return result("invalid");

  try {
    const response = await fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + githubToken,
        "Content-Type": "application/json",
        "User-Agent": "gyuniverse-github-projects-mcp",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query: VIEWER_QUERY }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401) return result("invalid");
    if (response.status === 429 ||
      (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      return result("rate_limited");
    }
    if (!response.ok) return result("unknown");

    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return result("unknown");
    }
    const { data, errors } = payload as {
      data?: { viewer?: { id?: unknown } | null };
      errors?: unknown[];
    };
    if (Array.isArray(errors) && errors.length > 0) return result("unknown");
    return result(typeof data?.viewer?.id === "string" && data.viewer.id.length > 0 ? "valid" : "unknown");
  } catch {
    return result("unknown");
  }
}
