import { AuditService, isAuditPersistenceFailure } from "../audit/audit-service.js";
import { WritePolicy, type WriteOperation } from "../policy/write-policy.js";
import { projectIdOf } from "../projects/project-service.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import {
  assignProjectWorkItem,
  type AssignWorkItemResult,
} from "../../workflow/assignee-update.js";
import {
  captureProjectBacklogItem,
  type CaptureBacklogResult,
  type CaptureBacklogWorkItemReader,
} from "../../workflow/capture-backlog.js";
import {
  createGitHubIssue,
  type CreatedIssue,
  type CreateIssueInput,
} from "../../workflow/create-work-item.js";
import {
  updateProjectSingleSelectByName,
  type NamedSingleSelectUpdateResult,
} from "../../workflow/single-select-update.js";

export interface HighLevelWriteProjectReader {
  resolveProject(owner: string, number: number): Promise<unknown>;
}

type NamedSingleSelectUpdater = typeof updateProjectSingleSelectByName;
type WorkItemAssigner = typeof assignProjectWorkItem;
type BacklogCapturer = typeof captureProjectBacklogItem;
type IssueCreator = typeof createGitHubIssue;

export interface HighLevelWriteServiceOptions {
  client: GitHubGraphQlClient;
  projects: HighLevelWriteProjectReader;
  workItems?: CaptureBacklogWorkItemReader;
  writePolicy: WritePolicy;
  auditService: AuditService;
  updateNamedSingleSelect?: NamedSingleSelectUpdater;
  assignWorkItem?: WorkItemAssigner;
  captureBacklog?: BacklogCapturer;
  createIssue?: IssueCreator;
}

interface AuditEnvelope {
  auditId: string;
  actorId: string | null;
  operation: WriteOperation;
  outcome: "success" | "no_change";
  auditPersistence: "process-local" | "upstash";
}

export interface HighLevelWriteResult extends NamedSingleSelectUpdateResult, AuditEnvelope {}
export interface HighLevelAssignResult extends AssignWorkItemResult, AuditEnvelope {}
export interface HighLevelCaptureBacklogResult extends CaptureBacklogResult, AuditEnvelope {}
export interface HighLevelCreateWorkItemResult extends AuditEnvelope {
  changed: true;
  verified: boolean;
  issue: CreatedIssue;
  capture: CaptureBacklogResult;
}

interface NamedUpdateInput {
  owner: string;
  number: number;
  itemId: string;
  optionName: string;
  fieldName: "Status" | "Priority";
  operation: "update_status" | "update_priority";
}

function logins(value: Array<{ login: string }>): string | null {
  const entries = value.map((item) => item.login).sort((a, b) => a.localeCompare(b));
  return entries.length > 0 ? entries.join(",") : null;
}

/**
 * Semantic Shared Core write orchestration.
 *
 * Transport adapters provide intent-level inputs. This service owns Project
 * resolution, authorization, idempotent mutation, verification, and actor-aware
 * audit so MCP and future REST adapters share identical behavior.
 */
export class HighLevelWriteService {
  private readonly updateNamedSingleSelect: NamedSingleSelectUpdater;
  private readonly assignProjectWorkItem: WorkItemAssigner;
  private readonly captureProjectBacklogItem: BacklogCapturer;
  private readonly createIssue: IssueCreator;

  constructor(private readonly options: HighLevelWriteServiceOptions) {
    this.updateNamedSingleSelect = options.updateNamedSingleSelect ?? updateProjectSingleSelectByName;
    this.assignProjectWorkItem = options.assignWorkItem ?? assignProjectWorkItem;
    this.captureProjectBacklogItem = options.captureBacklog ?? captureProjectBacklogItem;
    this.createIssue = options.createIssue ?? createGitHubIssue;
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

  async assignWorkItem(
    owner: string,
    number: number,
    itemId: string,
    assigneeLogin: string,
  ): Promise<HighLevelAssignResult> {
    const project = await this.options.projects.resolveProject(owner, number);
    const projectId = projectIdOf(project);
    const decision = this.options.writePolicy.authorize({ operation: "assign_work_item", projectId });

    try {
      const result = await this.assignProjectWorkItem(this.options.client, {
        projectId,
        itemId,
        assigneeLogin,
      });
      const outcome = result.changed ? "success" : "no_change";
      const audit = await this.options.auditService.record({
        operation: "assign_work_item",
        outcome,
        actorId: decision.actorId,
        projectId,
        projectOwner: owner,
        projectNumber: number,
        itemId,
        fieldName: "Assignees",
        requestedValue: result.requestedAssignee.login,
        beforeValue: logins(result.before),
        afterValue: logins(result.after),
        verified: result.verified,
        errorCode: null,
      });

      return {
        ...result,
        auditId: audit.id,
        actorId: audit.actorId,
        operation: "assign_work_item",
        outcome,
        auditPersistence: this.options.auditService.persistence,
      };
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      await this.options.auditService.recordFailure({
        operation: "assign_work_item",
        actorId: decision.actorId,
        projectId,
        projectOwner: owner,
        projectNumber: number,
        itemId,
        fieldName: "Assignees",
        requestedValue: assigneeLogin,
        beforeValue: null,
        afterValue: null,
      }, error);
      throw error;
    }
  }

  async captureBacklog(
    owner: string,
    number: number,
    url: string,
  ): Promise<HighLevelCaptureBacklogResult> {
    if (!this.options.workItems) {
      throw new Error("CAPTURE_BACKLOG_NOT_CONFIGURED: Work item resolver is unavailable.");
    }

    const project = await this.options.projects.resolveProject(owner, number);
    const projectId = projectIdOf(project);

    const addDecision = this.options.writePolicy.authorize({ operation: "add_project_item", projectId });
    this.options.writePolicy.authorize({ operation: "update_status", projectId });

    try {
      const result = await this.captureProjectBacklogItem(
        this.options.client,
        this.options.workItems,
        { owner, projectNumber: number, projectId, url },
      );
      const outcome = result.changed ? "success" : "no_change";
      const audit = await this.options.auditService.record({
        operation: "capture_backlog",
        outcome,
        actorId: addDecision.actorId,
        projectId,
        projectOwner: owner,
        projectNumber: number,
        itemId: result.itemId,
        fieldName: "Status",
        requestedValue: "Backlog",
        beforeValue: result.status.before?.name ?? null,
        afterValue: result.status.after?.name ?? null,
        verified: result.verified,
        errorCode: null,
      });

      return {
        ...result,
        auditId: audit.id,
        actorId: audit.actorId,
        operation: "capture_backlog",
        outcome,
        auditPersistence: this.options.auditService.persistence,
      };
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      await this.options.auditService.recordFailure({
        operation: "capture_backlog",
        actorId: addDecision.actorId,
        projectId,
        projectOwner: owner,
        projectNumber: number,
        itemId: null,
        fieldName: "Status",
        requestedValue: "Backlog",
        beforeValue: null,
        afterValue: null,
      }, error);
      throw error;
    }
  }

  async createWorkItem(
    owner: string,
    number: number,
    repository: string,
    title: string,
    body?: string | null,
  ): Promise<HighLevelCreateWorkItemResult> {
    if (!this.options.workItems) {
      throw new Error("CREATE_WORK_ITEM_NOT_CONFIGURED: Work item resolver is unavailable.");
    }

    const project = await this.options.projects.resolveProject(owner, number);
    const projectId = projectIdOf(project);

    // Pre-authorize the full chain before creating a repository Issue.
    const createDecision = this.options.writePolicy.authorize({ operation: "create_work_item", projectId });
    this.options.writePolicy.authorize({ operation: "add_project_item", projectId });
    this.options.writePolicy.authorize({ operation: "update_status", projectId });

    let issue: CreatedIssue | null = null;
    try {
      const createInput: CreateIssueInput = { owner, repository, title, body };
      issue = await this.createIssue(this.options.client, createInput);
      const capture = await this.captureProjectBacklogItem(
        this.options.client,
        this.options.workItems,
        { owner, projectNumber: number, projectId, url: issue.url },
      );

      const verified = capture.verified && capture.status.after?.name === "Backlog";
      if (!verified) {
        throw new Error("MUTATION_VERIFICATION_FAILED: Created Issue was not verified in Backlog.");
      }

      const audit = await this.options.auditService.record({
        operation: "create_work_item",
        outcome: "success",
        actorId: createDecision.actorId,
        projectId,
        projectOwner: owner,
        projectNumber: number,
        itemId: capture.itemId,
        fieldName: "Status",
        requestedValue: "Backlog",
        beforeValue: null,
        afterValue: capture.status.after?.name ?? null,
        verified,
        errorCode: null,
      });

      return {
        changed: true,
        verified,
        issue,
        capture,
        auditId: audit.id,
        actorId: audit.actorId,
        operation: "create_work_item",
        outcome: "success",
        auditPersistence: this.options.auditService.persistence,
      };
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      await this.options.auditService.recordFailure({
        operation: "create_work_item",
        actorId: createDecision.actorId,
        projectId,
        projectOwner: owner,
        projectNumber: number,
        itemId: null,
        fieldName: "Status",
        requestedValue: "Backlog",
        beforeValue: null,
        afterValue: null,
      }, error);
      if (issue) {
        throw new Error(`CREATE_WORK_ITEM_PARTIAL_FAILURE: Issue '${issue.url}' was created but Project capture failed. ${(error as Error).message}`);
      }
      throw error;
    }
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
      const audit = await this.options.auditService.record({
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
        auditPersistence: this.options.auditService.persistence,
      };
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      await this.options.auditService.recordFailure({
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
