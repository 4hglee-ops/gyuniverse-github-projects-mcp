import type { TeamAccessSnapshot, TeamResourceGrant } from "./team-access.js";

export interface TeamAccessStore {
  getSnapshot(subject: string): Promise<TeamAccessSnapshot>;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type Fetcher = (url: string, init: RequestInit) => Promise<FetchResponse>;

export class SupabaseTeamAccessStore implements TeamAccessStore {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol) ||
      (parsed.protocol === "http:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("TEAM_ACL_CONFIG_INVALID: A secure Supabase URL is required.");
    }
    if (!serviceKey) throw new Error("TEAM_ACL_CONFIG_INVALID: Supabase service credential is required.");
  }

  async getSnapshot(subject: string): Promise<TeamAccessSnapshot> {
    if (!subject || subject.length > 256) throw new Error("TEAM_ACL_SUBJECT_INVALID: Invalid subject.");
    // The subject comes exclusively from a verified MCP OAuth access token.
    const response = await this.fetcher(this.url.replace(/\/$/, "") + "/rest/v1/rpc/get_team_access_snapshot", {
      method: "POST",
      headers: {
        apikey: this.serviceKey,
        Authorization: "Bearer " + this.serviceKey,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ p_subject: subject }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("TEAM_ACL_UNAVAILABLE: Permission store request failed.");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.length > 1000) {
      throw new Error("TEAM_ACL_INVALID: Unexpected permission store response.");
    }
    const grants: TeamResourceGrant[] = payload.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("TEAM_ACL_INVALID: Malformed grant.");
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.teamId !== "string" || typeof record.resourceId !== "string" ||
        typeof record.externalResourceId !== "string" ||
        (record.provider !== "github_projects" && record.provider !== "jira") ||
        !["admin", "member", "viewer"].includes(String(record.teamRole)) ||
        !["admin", "member", "viewer"].includes(String(record.grantRole)) ||
        !(record.permissions === null || (Array.isArray(record.permissions) &&
          record.permissions.every(p => typeof p === "string")))) {
        throw new Error("TEAM_ACL_INVALID: Invalid grant values.");
      }
      return record as unknown as TeamResourceGrant;
    });
    return { grants };
  }
}
