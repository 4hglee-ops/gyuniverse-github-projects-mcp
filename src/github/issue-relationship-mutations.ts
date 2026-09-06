import { z } from "zod";
import { GitHubGraphQlClient } from "./graphql-client.js";

export const relationshipOperationSchema = z.enum(["add_sub_issue", "remove_sub_issue", "add_blocked_by", "remove_blocked_by"]);
export type RelationshipWriteOperation = z.infer<typeof relationshipOperationSchema>;
const operations = {
  add_sub_issue: { name: "addSubIssue", input: "AddSubIssueInput", target: "subIssue", targetInput: "subIssueId" },
  remove_sub_issue: { name: "removeSubIssue", input: "RemoveSubIssueInput", target: "subIssue", targetInput: "subIssueId" },
  add_blocked_by: { name: "addBlockedBy", input: "AddBlockedByInput", target: "blockingIssue", targetInput: "blockingIssueId" },
  remove_blocked_by: { name: "removeBlockedBy", input: "RemoveBlockedByInput", target: "blockingIssue", targetInput: "blockingIssueId" },
} as const;

/** Exactly one native mutation, never retry after an ambiguous response. */
export async function mutateIssueRelationship(client: GitHubGraphQlClient, operation: RelationshipWriteOperation, sourceId: string, targetId: string): Promise<void> {
  const parsed = relationshipOperationSchema.safeParse(operation);
  if (!parsed.success) throw new Error("RELATIONSHIP_OPERATION_UNSUPPORTED: Unsupported relationship mutation.");
  const spec = operations[parsed.data];
  let response: unknown;
  try {
    response = await client.request<unknown>(`mutation GuardedIssueRelationship($input: ${spec.input}!) {
      result: ${spec.name}(input: $input) { issue { id } target: ${spec.target} { id } }
    }`, { input: { issueId: sourceId, [spec.targetInput]: targetId,
      ...(operation === "add_sub_issue" ? { replaceParent: false } : {}) } });
  } catch {
    // GitHub may reject cycles, hierarchy limits, permission changes, or concurrent edits.
    // Do not expose raw GraphQL messages or imply that a network failure proves no write.
    throw new Error("RELATIONSHIP_MUTATION_FAILED: GitHub rejected the operation or its outcome is unknown. Re-read before retrying; no automatic retry was performed.");
  }
  const schema = z.object({ result: z.object({ issue: z.object({ id: z.literal(sourceId) }), target: z.object({ id: z.literal(targetId) }) }) });
  if (!schema.safeParse(response).success) {
    throw new Error("RELATIONSHIP_MUTATION_RESPONSE_INVALID: Mutation acknowledgement is invalid; state may have changed. Re-read before retrying.");
  }
}
