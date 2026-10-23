import type { AppConfig } from "../config.js";
import { IdentityContextService } from "../core/identity/identity-context-service.js";
import { principalHasProjectPermission } from "../core/identity/principal.js";
import { ProjectService } from "../core/projects/project-service.js";
import { AuditService } from "../core/audit/audit-service.js";
import { ProjectViewService } from "../core/views/project-view-service.js";
import { projectViewCatalog } from "../core/views/project-view-catalog.js";
import { viewTargetSchema, viewPreviewSchema, viewApplySchema } from "../core/views/view-plan.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { GitHubRestClient } from "../github/rest-client.js";
import type { ViewPlanStore } from "../core/views/view-plan-store.js";
import { operatorConfig, type VerifiedOperator } from "../http/operator-auth.js";
import { WritePolicy } from "../core/policy/write-policy.js";

export interface AdminViewRuntime {
  config?: AppConfig; client?: GitHubGraphQlClient; restClient?: GitHubRestClient;
  auditService?: AuditService; viewPlanStore?: ViewPlanStore;
}
/** Same Core and schemas as bearer REST, with a fresh session/source/ACL check before each mutation. */
export async function handleAdminView(path: string, method: string, body: unknown, operator: VerifiedOperator,
  refresh: () => Promise<VerifiedOperator>, options: AdminViewRuntime = {}): Promise<unknown> {
  const config = operatorConfig(operator), principal = operator.principal;
  if (path === "identity" && method === "GET") return new IdentityContextService(principal).getContext();
  const client = options.client ?? new GitHubGraphQlClient(config.githubToken);
  if (path === "project/catalog" && method === "GET") return projectViewCatalog(config, client, principal);
  if (method !== "POST" || !["project/views", "project/views/preview", "write/views/apply", "write/views/update"].includes(path)) {
    throw new Error("ADMIN_ROUTE_NOT_FOUND: Unsupported admin View route.");
  }
  const service = new ProjectViewService({ config, client, rest: options.restClient ?? new GitHubRestClient(config.githubToken),
    principal, projects: new ProjectService({ config, client, principal }), audit: options.auditService ?? new AuditService(200), store: options.viewPlanStore,
    assertCurrentWrite: async (projectId) => {
      const current = await refresh();
      if (current.principal.id !== principal.id || current.principal.role !== "admin"
        || !principalHasProjectPermission(current.principal, projectId, "project.read")) throw new Error("PERMISSION_DENIED: Current session cannot change this Project.");
      new WritePolicy(operatorConfig(current), current.principal).authorize({ operation: "configure_project_views", projectId });
    },
  });
  if (path === "project/views") { const input = viewTargetSchema.parse(body); return service.list(input.owner, input.number); }
  if (path === "project/views/preview") return service.preview(viewPreviewSchema.parse(body));
  return service.apply(viewApplySchema.parse(body), path.endsWith("update") ? "update" : "template");
}
