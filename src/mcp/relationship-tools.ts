import type { McpServer } from "@modelcontextprotocol/server";
import { ProjectRelationshipService, relationshipInputSchema } from "../core/relationships/project-relationship-service.js";

export function registerRelationshipTools(server: McpServer, relationships: ProjectRelationshipService) {
  server.registerTool("get_github_project_item_relationships", {
    description: "Read native parent, sub-issue, blocks and blocked-by relationships for a GitHub Issue item in an authorized Project. Only same-Project, allowed-owner target details are returned; withheld counts and bounded coverage are explicit. Does not mutate GitHub or change get_blockers semantics.",
    inputSchema: relationshipInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (input) => ({ content: [{ type: "text" as const, text: JSON.stringify(await relationships.getRelationships(input), null, 2) }] }));
}
