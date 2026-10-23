import type { McpServer } from "@modelcontextprotocol/server";
import type { ProjectViewService } from "../core/views/project-view-service.js";
import { viewApplySchema, viewPreviewSchema, viewTargetSchema } from "../core/views/view-plan.js";

export function registerProjectViewTools(server: McpServer, service: ProjectViewService) {
  const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  server.registerTool("list_project_views", {
    description: "Read all Views and observable configuration inside an authorized Project. No GitHub writes.", inputSchema: viewTargetSchema, annotations: read,
  }, async ({ owner, number }) => json(await service.list(owner, number)));
  server.registerTool("preview_project_view_setup", {
    description: "Preview a template OR a supported View update. Returns immutable planId/digest/15-minute TTL. Persists a plan but never changes GitHub. Conflicts require manual review.",
    inputSchema: viewPreviewSchema, annotations: { ...read, idempotentHint: false },
  }, async (input) => json(await service.preview(input)));
  server.registerTool("apply_project_view_setup", {
    description: "Admin-only: explicitly approve and apply the exact template preview. Rechecks ACL/state, locks the Project, verifies/audits each change. Inspect partial/uncertain results; never blindly retry.",
    inputSchema: viewApplySchema, annotations: write,
  }, async (input) => json(await service.apply(input, "template")));
  server.registerTool("update_project_view", {
    description: "Admin-only: explicitly approve a View update preview for name/filter/layout/visible fields. Group/sort/Roadmap dates require manual UI work. No delete tool.",
    inputSchema: viewApplySchema, annotations: write,
  }, async (input) => json(await service.apply(input, "update")));
}
