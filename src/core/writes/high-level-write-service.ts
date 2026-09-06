import { AuditService } from "../audit/audit-service.js";
import { WritePolicy, type WriteOperation } from "../policy/write-policy.js";
import { projectIdOf } from "../projects/project-service.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import {
  updateProjectSingleSelectByName,
  type NamedSingleSelectUpdateResult,
} from "../../workflow/single-select-update.js";

export interface HighLevelWriteProjectReader {
  resolveProject(owner: string, number: number): Promise<unknown>;
}

type NamedSingleSelectUpdater = typeof updateProjectSingleSelectByName;

export interface HighLevelWriteServiceOptions {
  client: GitHubGraphQlClient;
  projects: HighLevelWriteProjectReader;
  writePolicy: WritePolicy;
  auditService: AuditService;
  updateNamedSingleSelect?: NamedSingleSelectUpdater;
}

export interface HighLevelWriteResult extends NamedSingleSelectUpdateResult {
  auditId: string;
  actorId: string | null;
  operation: WriteOperation;
  outcome: "success" | "no_change";
  auditPersistence: "process-local";
}

interface NamedUpdateInput {
  owner: string;
  number: number;
  itemId: string;
  optionName: string;
  fieldName: "Status" | "Priority";
  operation: "update_status" | "update_priority";
}

/**
 * Semantic Shared Core write orchestration.
 *
 * Transport adapters provide intent-level inputs (Status/Priority/start work). This
 * service owns Project resolution, authorization, idempotent mutation, verification,
 * and actor-aware audit so MCP and future REST adapters share identical behavior.
 */
export class HighLevelWriteService {
  private readonly updateNamedSingleSelect: NamedSingleSelectUpdater;

  constructor(private readonly options: HighLevelWriteServiceOptions) {
    this.updateNamedSingleSelect = options.updateNamedSingleSelect ?? updateProjectSingleSelectByName;
  }

  async updateWorkItemStatus(
    owner: string,
    number: number,
    itemId: string,
    status: string,
  ): Promise<HighLevelWriteResult> {
    return this.runNamedUpdate({
      owner,
      number,
      itemId,
      optionName: status,
      fieldName: "Status",
      operation: "update_status",
    });
  }

  async updateWorkItemPriority(
    owner: string,
    number: number,
    itemId: string,
    priority: string,
  ): Promise<HighLevelWriteResult> {
    return this.runNamedUpdate({
      owner,
      number,
      itemId,
      optionName: priority,
      fieldName: "Priority",
      operation: "update_priority",
    });
  }

  async startWork(owner: string, number: number, itemId: string): Promise<HighLevelWriteResult> {
    return this.updateWorkItemStatus(owner, number, itemId, "In Progress");
  }

  private async runNamedUpdate(input: NamedUpdateInput): Promise<HighLevelWriteResult> {
    const project = await this.options.projects.resolveProject(input.owner, input.number);
    const projectId = projectIdOf(project);
    const decision = this.options.writePolicy.authorize({ operation: input.operation, projectId });

    try {
      const result = await this.updateNamedSingleSelect(this.options.client, {
        owner: input.owner,
        projectNumber: input.number,
        projectId,
        itemId: input.itemId,
        fieldName: input.fieldName,
        optionName: input.optionName,
      });

      const outcome = result.changed ? "success" : "no_change";
      const audit = this.options.auditService.record({
        operation: input.operation,
        outcome,
        actorId: decision.actorId,
        projectId,
        projectOwner: input.owner,
        projectNumber: input.number,
        itemId: input.itemId,
        fieldName: input.fieldName,
        requestedValue: input.optionName,
        beforeValue: result.before?.name ?? null,
        afterValue: result.after?.name ?? null,
        verified: result.verified,
        errorCode: null,
      });

      return {
        ...result,
        auditId: audit.id,
        actorId: audit.actorId,
        operation: input.operation,
        outcome,
        auditPersistence: "process-local",
      };
    } catch (error) {
      this.options.auditService.recordFailure({
        operation: input.operation,
        actorId: decision.actorId,
        projectId,
        projectOwner: input.owner,
        projectNumber: input.number,
        itemId: input.itemId,
        fieldName: input.fieldName,
        requestedValue: input.optionName,
        beforeValue: null,
        afterValue: null,
      }, error);
      throw error;
    }
  }
}
