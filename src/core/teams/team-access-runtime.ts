import type { AuthenticatedPrincipal } from "../identity/principal.js";
import { restrictPrincipalToTeamAccess } from "./team-access.js";
import { SupabaseTeamAccessStore, type TeamAccessStore } from "./team-access-store.js";

export type TeamAclMode = "legacy" | "enforce";

export function teamAclMode(): TeamAclMode {
  const value = process.env.M12_TEAM_ACL_MODE?.trim() || "legacy";
  if (value !== "legacy" && value !== "enforce") {
    throw new Error("TEAM_ACL_CONFIG_INVALID: M12_TEAM_ACL_MODE must be legacy or enforce.");
  }
  return value;
}

/** No fallback to existing project privileges once DB enforcement is enabled. */
export function createTeamAccessStore(): TeamAccessStore | null {
  if (teamAclMode() === "legacy") return null;
  const url = process.env.M12_SUPABASE_URL?.trim();
  const key = process.env.M12_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("TEAM_ACL_CONFIG_INVALID: Team ACL database is not configured.");
  return new SupabaseTeamAccessStore(url, key);
}

export async function resolveTeamScopedPrincipal(
  principal: AuthenticatedPrincipal | null,
  store: TeamAccessStore | null,
): Promise<AuthenticatedPrincipal | null> {
  if (!principal || !store) return principal;
  try {
    const snapshot = await store.getSnapshot(principal.id);
    return restrictPrincipalToTeamAccess(principal, snapshot);
  } catch {
    throw new Error("TEAM_ACL_UNAVAILABLE: Unable to authorize this request.");
  }
}
