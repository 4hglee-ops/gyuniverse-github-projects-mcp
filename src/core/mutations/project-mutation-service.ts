import { AuditService, isAuditPersistenceFailure } from "../audit/audit-service.js";
import { WritePolicy } from "../policy/write-policy.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import {
  addItemToProject,
  type ProjectFieldValue,
  updateProjectItemField,
} from "../../github/projects.js";

export interface ProjectMutationServiceOptions {
  client: GitHubGraphQlClient;
  writePolicy: WritePolicy;
  auditService: AuditService;
}

/**
 * Shared mutation boundary for low-level Project item writes.
 *
 * Adapters provide validated transport input only. Policy authorization, mutation
 * execution, and audit recording stay in Shared Core so MCP and future REST adapters
 * do not duplicate write behavior.
 */
export class ProjectMutationService {
  constructor(private readonly options: ProjectMutationServiceOptions) {}

  async addProjectItem(projectId: string, contentId: string): Promise<unknown> {
    const decision = this.options.writePolicy.authorize({ operation: "add_project_item", projectId });

    try {
      const result = await addItemToProject(this.options.client, projectId, contentId);
      await this.options.auditService.record({
        operation: "add_project_item",
        outcome: "success",
        actorId: decision.actorId,
        projectId,
        projectOwner: null,
        projectNumber: null,
        itemId: null,
        fieldName: null,
        requestedValue: null,
        beforeValue: null,
        afterValue: null,
        verified: false,
        errorCode: null,
      });
      return result;
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      await this.options.auditService.recordFailure({
        operation: "add_project_item",
        actorId: decision.actorId,
        projectId,
        projectOwner: null,
        projectNumber: null,
        itemId: null,
        fieldName: null,
        requestedValue: null,
        beforeValue: null,
        afterValue: null,
      }, error);
      throw error;
    }
  }

  async updateProjectItemField(
    projectId: string,
    itemId: string,
    fieldId: string,
    value: ProjectFieldValue,
  ): Promise<unknown> {
    const decision = this.options.writePolicy.authorize({ operation: "update_project_item_field", projectId });

    try {
      const result = await updateProjectItemField(
        this.options.client,
        projectId,
        itemId,
        fieldId,
        value,
      );
      await this.options.auditService.record({
        operation: "update_project_item_field",
        outcome: "success",
        actorId: decision.actorId,
        projectId,
        projectOwner: null,
        projectNumber: null,
        itemId,
        fieldName: null,
        requestedValue: null,
        beforeValue: null,
        afterValue: null,
        verified: false,
        errorCode: null,
      });
      return result;
    } catch (error) {
      if (isAuditPersistenceFailure(error)) throw error;
      await this.options.auditService.recordFailure({
        operation: "update_project_item_field",
        actorId: decision.actorId,
        projectId,
        projectOwner: null,
        projectNumber: null,
        itemId,
        fieldName: null,
        requestedValue: null,
        beforeValue: null,
        afterValue: null,
      }, error);
      throw error;
    }
  }
}
