import { principalForRole, type AuthenticatedPrincipal, type ProjectRole } from "./principal.js";

export interface OAuthIdentityRecord {
  subject: string;
  accessCode: string;
  displayName?: string | null;
  githubLogin?: string | null;
  role: ProjectRole;
  projectIds: string[];
}

function normalizeRecord(value: unknown): OAuthIdentityRecord {
  if (!value || typeof value !== "object") throw new Error("OAuth identity entry must be an object.");
  const item = value as Record<string, unknown>;
  const subject = typeof item.subject === "string" ? item.subject.trim() : "";
  const accessCode = typeof item.accessCode === "string" ? item.accessCode.trim() : "";
  const role = item.role;
  const projectIds = Array.isArray(item.projectIds)
    ? item.projectIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
    : [];
  if (!subject || !accessCode) throw new Error("OAuth identity subject and accessCode are required.");
  if (role !== "admin" && role !== "member" && role !== "viewer") throw new Error(`Unsupported OAuth identity role for '${subject}'.`);
  if (projectIds.length === 0) throw new Error(`OAuth identity '${subject}' must allow at least one Project node ID.`);
  return {
    subject,
    accessCode,
    role,
    projectIds: [...new Set(projectIds)],
    displayName: typeof item.displayName === "string" ? item.displayName.trim() || null : null,
    githubLogin: typeof item.githubLogin === "string" ? item.githubLogin.trim() || null : null,
  };
}

export class OAuthIdentityRegistry {
  private readonly records: OAuthIdentityRecord[];

  constructor(records: OAuthIdentityRecord[]) {
    const subjects = new Set<string>();
    const codes = new Set<string>();
    this.records = records.map((record) => normalizeRecord(record));
    for (const record of this.records) {
      if (subjects.has(record.subject)) throw new Error(`Duplicate OAuth identity subject: ${record.subject}`);
      if (codes.has(record.accessCode)) throw new Error("Duplicate OAuth identity accessCode is not allowed.");
      subjects.add(record.subject);
      codes.add(record.accessCode);
    }
  }

  static fromEnvironment(): OAuthIdentityRegistry {
    const raw = process.env.MCP_OAUTH_IDENTITIES_JSON?.trim();
    if (!raw) return new OAuthIdentityRegistry([]);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error("MCP_OAUTH_IDENTITIES_JSON must be valid JSON."); }
    if (!Array.isArray(parsed)) throw new Error("MCP_OAUTH_IDENTITIES_JSON must be a JSON array.");
    return new OAuthIdentityRegistry(parsed.map(normalizeRecord));
  }

  resolveByAccessCode(accessCode: string): OAuthIdentityRecord | null {
    const normalized = accessCode.trim();
    if (!normalized) return null;
    return this.records.find((record) => record.accessCode === normalized) ?? null;
  }

  resolvePrincipal(subject: string): AuthenticatedPrincipal | null {
    const record = this.records.find((item) => item.subject === subject);
    if (!record) return null;
    return principalForRole(record.subject, record.role, {
      source: "oauth",
      displayName: record.displayName ?? null,
      githubLogin: record.githubLogin ?? null,
      projectIds: record.projectIds,
    });
  }
}
