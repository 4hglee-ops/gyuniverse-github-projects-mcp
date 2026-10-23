import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { principalHasProjectPermission, type AuthenticatedPrincipal } from "../identity/principal.js";

const projectSchema = z.object({
  id: z.string().min(1), number: z.number().int().positive(), title: z.string(),
  owner: z.object({ login: z.string().min(1) }), viewerCanUpdate: z.boolean(),
});

/** Resolve only known authorized IDs; never enumerate an owner's other Projects. */
export async function projectViewCatalog(config: AppConfig, client: GitHubGraphQlClient, principal: AuthenticatedPrincipal) {
  if (!config.allowedOwners.length || !config.allowedProjectIds.length) {
    throw new Error("PROJECT_CATALOG_UNAVAILABLE: Explicit owner and Project allowlists are required.");
  }
  const ids = [...new Set(principal.projectIds)].filter((id) => config.allowedProjectIds.includes(id)
    && principalHasProjectPermission(principal, id, "project.read"));
  if (ids.length > 100) throw new Error("PROJECT_CATALOG_UNAVAILABLE: Authorized Project catalog exceeds its safety bound.");
  if (!ids.length) return { projects: [], omittedProjectCount: 0 };
  let raw: unknown;
  try {
    raw = await client.request(`query ProjectViewCatalog($ids: [ID!]!) {
      nodes(ids: $ids) { ... on ProjectV2 { id number title viewerCanUpdate
        owner { ... on Organization { login } ... on User { login } }
      } }
    }`, { ids });
  } catch { throw new Error("PROJECT_CATALOG_UNAVAILABLE: Unable to resolve authorized Projects."); }
  const parsed = z.object({ nodes: z.array(projectSchema.nullable()).max(100) }).safeParse(raw);
  if (!parsed.success || parsed.data.nodes.length !== ids.length) {
    throw new Error("PROJECT_CATALOG_UNAVAILABLE: Project catalog response is incomplete.");
  }
  const seen = new Set<string>();
  const projects = parsed.data.nodes.flatMap((p) => {
    if (!p) return [];
    if (!ids.includes(p.id) || seen.has(p.id)) throw new Error("PROJECT_CATALOG_UNAVAILABLE: Unexpected Project identity.");
    seen.add(p.id);
    if (!config.allowedOwners.includes(p.owner.login)) return [];
    return [{ id: p.id, owner: p.owner.login, number: p.number, title: p.title,
      canWriteViews: config.writeEnabled && p.viewerCanUpdate && principal.role === "admin"
        && principalHasProjectPermission(principal, p.id, "project.write")
        && principalHasProjectPermission(principal, p.id, "project.view.write"),
    }];
  });
  return { projects, omittedProjectCount: ids.length - projects.length };
}
