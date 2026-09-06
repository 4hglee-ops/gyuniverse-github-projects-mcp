import type { AppConfig } from "../../config.js";
import type { GitHubGraphQlClient } from "../../github/graphql-client.js";
import type { AuditService } from "../audit/audit-service.js";
import { BulkPlanService } from "../bulk/bulk-plan-service.js";
import { createBulkPlanStore } from "../bulk/bulk-plan-store-factory.js";
import type { BulkPlanStoreLike } from "../bulk/bulk-plan-store.js";
import type { AuthenticatedPrincipal } from "../identity/principal.js";
import type { WritePolicy } from "../policy/write-policy.js";
import type { ProjectService } from "../projects/project-service.js";
import { ProjectRelationshipService } from "../relationships/project-relationship-service.js";
import { RelationshipWriteService } from "../relationships/relationship-write-service.js";

interface M10GovernanceServicesOptions {
  config: AppConfig;
  client: GitHubGraphQlClient;
  principal: AuthenticatedPrincipal | null;
  projects: Pick<ProjectService, "resolveProject">;
  writePolicy: WritePolicy;
  audit: AuditService;
  bulkStore?: BulkPlanStoreLike;
}

/**
 * Shared M10 service composition for MCP tools and the GPT Actions REST facade.
 * Authorization remains inside ProjectService, WritePolicy and the M10 services;
 * transport adapters only validate input and dispatch.
 */
export function createM10GovernanceServices(options: M10GovernanceServicesOptions) {
  const relationships = new ProjectRelationshipService({
    config: options.config,
    client: options.client,
    projects: options.projects,
  });
  const relationshipWrites = new RelationshipWriteService({
    principal: options.principal,
    client: options.client,
    projects: options.projects,
    reads: relationships,
    writePolicy: options.writePolicy,
    audit: options.audit,
  });
  const bulk = new BulkPlanService({
    client: options.client,
    projects: options.projects,
    principal: options.principal,
    writePolicy: options.writePolicy,
    audit: options.audit,
    store: options.bulkStore ?? createBulkPlanStore(),
    bulkApprovalMode: options.config.bulkApprovalMode,
  });

  return { relationships, relationshipWrites, bulk };
}
