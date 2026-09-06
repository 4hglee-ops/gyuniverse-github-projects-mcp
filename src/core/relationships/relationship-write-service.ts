import { z } from "zod";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { mutateIssueRelationship, relationshipOperationSchema, type RelationshipWriteOperation } from "../../github/issue-relationship-mutations.js";
import type { RecordWriteAuditInput } from "../../workflow/write-audit.js";
import { AuditService, isAuditPersistenceFailure } from "../audit/audit-service.js";
import { IdentityPolicy } from "../identity/identity-policy.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";
import { WritePolicy } from "../policy/write-policy.js";
import { projectIdOf, type ProjectService } from "../projects/project-service.js";
import { ProjectRelationshipService } from "./project-relationship-service.js";

export const relationshipWriteInputSchema = z.object({
  owner: z.string().min(1).max(100), number: z.number().int().positive(),
  sourceItemId: z.string().min(1).max(256), targetItemId: z.string().min(1).max(256),
}).strict();
export type RelationshipWriteInput = z.infer<typeof relationshipWriteInputSchema>;
type ReadResult = Awaited<ReturnType<ProjectRelationshipService["getRelationships"]>>;
type Group = ReadResult["parent"];

function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
function complete(group: Group): void {
  if (!group.coverage.complete) fail("RELATIONSHIP_COVERAGE_INCOMPLETE", "Required relationship evidence is truncated or withheld.");
}
function present(group: Group, targetId: string): boolean {
  complete(group);
  return group.targets.some((target) => target.contentId === targetId);
}
const SAFE_CODES = new Set(["RELATIONSHIP_COVERAGE_INCOMPLETE", "RELATIONSHIP_SELF_REJECTED", "RELATIONSHIP_CYCLE_REJECTED",
  "RELATIONSHIP_CYCLE_CHECK_INCOMPLETE", "RELATIONSHIP_PARENT_EXISTS", "RELATIONSHIP_PRECONDITION_FAILED",
  "RELATIONSHIP_VERIFICATION_FAILED", "RELATIONSHIP_MUTATION_FAILED", "RELATIONSHIP_MUTATION_RESPONSE_INVALID"]);
function boundedFailure(error: unknown, postAttempt: boolean): Error {
  const message = error instanceof Error ? error.message : "";
  const code = /^([A-Z_]+):/.exec(message)?.[1];
  if (code && SAFE_CODES.has(code)) return new Error(message);
  return new Error(postAttempt
    ? "RELATIONSHIP_VERIFICATION_FAILED: Final state could not be proven; re-read before retrying."
    : "RELATIONSHIP_PRECONDITION_FAILED: Source/target authorization, availability or relationship evidence could not be established.");
}

/** Single-edge governance only; no bulk, reparenting, automatic rollback or mutation retries. */
export class RelationshipWriteService {
  constructor(private readonly options: {
    principal: AuthenticatedPrincipal | null; client: GitHubGraphQlClient;
    projects: Pick<ProjectService, "resolveProject">; reads: Pick<ProjectRelationshipService, "getRelationships">;
    writePolicy: WritePolicy; audit: AuditService;
  }) {}

  async execute(operation: RelationshipWriteOperation, input: RelationshipWriteInput) {
    if (!relationshipOperationSchema.safeParse(operation).success) fail("RELATIONSHIP_OPERATION_UNSUPPORTED", "Unsupported relationship mutation.");
    const parsed = relationshipWriteInputSchema.safeParse(input);
    if (!parsed.success) fail("RELATIONSHIP_INPUT_INVALID", "Expected one source and target Project item.");
    const args = parsed.data;
    const identity = new IdentityPolicy();
    identity.assertPermission(this.options.principal, "item.relationship.write");
    let projectId: string;
    try {
      projectId = projectIdOf(await this.options.projects.resolveProject(args.owner, args.number));
    } catch {
      fail("RELATIONSHIP_PROJECT_ACCESS_FAILED", "Project authorization or lookup could not be established.");
    }
    const decision = this.options.writePolicy.authorize({ operation, projectId });
    const subIssue = operation.endsWith("sub_issue");
    const desired = operation.startsWith("add_");
    const relationshipType = subIssue ? "sub_issue" as const : "blocked_by" as const;
    const auditBase: Omit<RecordWriteAuditInput, "outcome" | "verified" | "errorCode"> = {
      operation, actorId: decision.actorId, projectId, projectOwner: args.owner, projectNumber: args.number,
      itemId: args.sourceItemId, fieldName: relationshipType, requestedValue: desired ? "present" : "absent",
      beforeValue: null, afterValue: null,
    };
    let postAttempt = false;
    const read = async (itemId: string): Promise<ReadResult> => {
      const result = await this.options.reads.getRelationships({ owner: args.owner, number: args.number, itemId, first: 100 });
      if (result.project.id !== projectId || result.source.itemId !== itemId || !result.source.insideAuthorizedProject ||
          !result.coverage.projectInventory.complete) fail("RELATIONSHIP_PRECONDITION_FAILED", "Project membership evidence changed or is incomplete.");
      return result;
    };
    try {
      if (args.sourceItemId === args.targetItemId) fail("RELATIONSHIP_SELF_REJECTED", "Source and target must differ.");
      const source = await read(args.sourceItemId);
      const target = await read(args.targetItemId);
      const sourceId = source.source.contentId;
      const targetId = target.source.contentId;
      if (sourceId === targetId) fail("RELATIONSHIP_SELF_REJECTED", "Source and target Issues must differ.");
      auditBase.relationship = { sourceContentId: sourceId, targetItemId: target.source.itemId, targetContentId: targetId, type: relationshipType };
      const stateOf = (s: ReadResult, t: ReadResult) => {
        if (s.source.contentId !== sourceId || t.source.contentId !== targetId) fail("RELATIONSHIP_PRECONDITION_FAILED", "Resolved Issue identity changed.");
        const forward = present(subIssue ? s.subIssues : s.blockedBy, targetId);
        const reverse = present(subIssue ? t.parent : t.blocks, sourceId);
        if (forward !== reverse) fail("RELATIONSHIP_PRECONDITION_FAILED", "Forward and reverse relationship evidence disagree.");
        return forward;
      };
      const before = stateOf(source, target);
      auditBase.beforeValue = before ? "present" : "absent";
      if (desired && !before) {
        if (subIssue && target.parent.coverage.totalCount !== 0) fail("RELATIONSHIP_PARENT_EXISTS", "Target already has a parent; implicit reparenting is forbidden.");
        await this.assertNoCycle(subIssue ? source : target, subIssue ? targetId : sourceId, subIssue ? "parent" : "blockedBy", read);
      }
      if (before !== desired) {
        postAttempt = true;
        await mutateIssueRelationship(this.options.client, operation, sourceId, targetId);
      }
      // Even no_change must be proven by a fresh normalized re-read, not the first observation.
      postAttempt = true;
      const afterSource = await read(args.sourceItemId);
      const afterTarget = await read(args.targetItemId);
      const after = stateOf(afterSource, afterTarget);
      auditBase.afterValue = after ? "present" : "absent";
      if (after !== desired) fail("RELATIONSHIP_VERIFICATION_FAILED", "Normalized re-read did not prove the requested state. Re-read before retrying.");
      const outcome = before === desired ? "no_change" as const : "success" as const;
      const audit = await this.options.audit.record({ ...auditBase, outcome, verified: true, errorCode: null });
      return { operation, relationshipType, project: source.project, source: source.source, target: target.source,
        changed: before !== desired, before, after, verified: true,
        outcome, reason: outcome === "no_change" ? "already_at_requested_relationship_state" : "relationship_state_verified",
        auditId: audit.id, actorId: audit.actorId, auditPersistence: this.options.audit.persistence,
        verification: { source: subIssue ? afterSource.subIssues : afterSource.blockedBy,
          target: subIssue ? afterTarget.parent : afterTarget.blocks,
          evidence: "Both directions re-read through M10-3 normalized relationship service; complete coverage required. Observations are not transactional." },
      };
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      const safe = boundedFailure(error, postAttempt);
      await this.options.audit.recordFailure(auditBase, safe);
      throw safe;
    }
  }

  private async assertNoCycle(start: ReadResult, forbiddenId: string, groupName: "parent" | "blockedBy", read: (itemId: string) => Promise<ReadResult>) {
    const queue = [start];
    const seen = new Set<string>();
    let scheduled = 1;
    while (queue.length) {
      const current = queue.shift()!;
      const id = current.source.contentId;
      if (id === forbiddenId) fail("RELATIONSHIP_CYCLE_REJECTED", "Relationship would introduce a cycle.");
      if (seen.has(id)) continue;
      seen.add(id);
      const group = current[groupName];
      complete(group);
      for (const target of group.targets) {
        if (target.contentId === forbiddenId) fail("RELATIONSHIP_CYCLE_REJECTED", "Relationship would introduce a cycle.");
        if (seen.has(target.contentId)) continue;
        if (++scheduled > 20) fail("RELATIONSHIP_CYCLE_CHECK_INCOMPLETE", "Cycle check exceeds the 20-node safety bound.");
        queue.push(await read(target.itemId));
      }
    }
  }
}
