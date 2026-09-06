import type { McpServer } from "@modelcontextprotocol/server";
import { RelationshipWriteService, relationshipWriteInputSchema } from "../core/relationships/relationship-write-service.js";

const tools = [
  ["add_github_project_sub_issue", "add_sub_issue", "Add target as a sub-issue of source. Never replace an existing parent."],
  ["remove_github_project_sub_issue", "remove_sub_issue", "Remove target from source's sub-issues. Does not delete either Issue."],
  ["add_github_project_blocked_by", "add_blocked_by", "Make source blocked by target: target blocks source."],
  ["remove_github_project_blocked_by", "remove_blocked_by", "Remove source's blocked-by relationship to target."],
] as const;

export function registerRelationshipWriteTools(server: McpServer, writes: RelationshipWriteService) {
  for (const [name, operation, meaning] of tools) server.registerTool(name, {
    description: `${meaning} Single relationship only. Both Issue items must belong to the same authorized Project. Requires an authenticated actor with project.write and item.relationship.write plus the global write gate. Re-reads both directions and persists audit, including no_change. Do not retry failures automatically.`,
    inputSchema: relationshipWriteInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: operation.startsWith("remove_"), idempotentHint: true, openWorldHint: true },
  }, async (input) => ({ content: [{ type: "text" as const, text: JSON.stringify(await writes.execute(operation, input), null, 2) }] }));
}
