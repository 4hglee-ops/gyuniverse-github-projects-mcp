import { z } from "zod";

import { type AppConfig, loadConfig } from "../config.js";
import { AuditService } from "../core/audit/audit-service.js";
import type { BulkPlanStoreLike } from "../core/bulk/bulk-plan-store.js";
import { createM10GovernanceServices } from "../core/governance/m10-services.js";
import { IdentityContextService } from "../core/identity/identity-context-service.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { WritePolicy } from "../core/policy/write-policy.js";
import { ProjectService } from "../core/projects/project-service.js";
import { HighLevelReadService } from "../core/reads/high-level-read-service.js";
import { SnapshotService } from "../core/snapshots/snapshot-service.js";
import { WorkItemService } from "../core/work-items/work-item-service.js";
import { HighLevelWriteService } from "../core/writes/high-level-write-service.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import {
  bearerToken,
  oauthAccessTokenPayload,
  OAUTH_READ_SCOPE,
  OAUTH_WRITE_SCOPE,
  scopeIncludes,
} from "../oauth/stateless.js";
import { configForRemoteScope, resolveRemotePrincipal } from "./remote-mcp.js";

const projectInput = z.object({
  owner: z.string().min(1),
  number: z.number().int().min(1),
  first: z.number().int().min(1).max(100).default(100),
  includeArchived: z.boolean().default(false),
});

const myWorkInput = projectInput.extend({ includeDone: z.boolean().default(false) });
const writeTargetInput = z.object({ owner: z.string().min(1), number: z.number().int().min(1), itemId: z.string().min(1) });
const statusInput = writeTargetInput.extend({ status: z.string().min(1) });
const priorityInput = writeTargetInput.extend({ priority: z.string().min(1) });
const assignInput = writeTargetInput.extend({ assigneeLogin: z.string().min(1) });
const captureInput = z.object({ owner: z.string().min(1), number: z.number().int().min(1), url: z.string().url() });
const createInput = z.object({
  owner: z.string().min(1),
  number: z.number().int().min(1),
  repository: z.string().min(1),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
});
const relationshipReadInput = z.object({
  owner: z.string().min(1).max(100),
  number: z.number().int().positive(),
  itemId: z.string().min(1).max(256),
  first: z.number().int().min(1).max(100).default(50),
}).strict();
const relationshipWriteInput = z.object({
  owner: z.string().min(1).max(100),
  number: z.number().int().positive(),
  sourceItemId: z.string().min(1).max(256),
  targetItemId: z.string().min(1).max(256),
}).strict();
const bulkPreviewInput = z.object({
  owner: z.string().min(1).max(100),
  number: z.number().int().positive(),
  operations: z.array(z.object({
    itemId: z.string().min(1).max(256),
    field: z.enum(["Status", "Priority"]),
    value: z.string().min(1).max(256),
  }).strict()).min(1).max(20),
}).strict();
const bulkPlanReferenceInput = z.object({
  planId: z.string().regex(/^bulk-plan-[0-9a-f-]{36}$/),
  planDigest: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
const bulkPlanGetInput = bulkPlanReferenceInput.pick({ planId: true });

export interface RestApiRuntimeOptions {
  config?: AppConfig;
  client?: GitHubGraphQlClient;
  identityRegistry?: OAuthIdentityRegistry;
  auditService?: AuditService;
  bulkStore?: BulkPlanStoreLike;
}

export function restPathRequiresWrite(pathname: string): boolean {
  return pathname.startsWith("/api/v1/write/");
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]+):/.exec(message);
  return match?.[1] ?? "REST_REQUEST_FAILED";
}

function statusForError(error: unknown): number {
  const code = errorCode(error);
  if (["PERMISSION_DENIED", "CAPABILITY_REQUIRED", "IDENTITY_REQUIRED", "PROJECT_MEMBERSHIP_DENIED", "PROJECT_WRITE_NOT_ALLOWED"].includes(code)) return 403;
  return 400;
}

interface ActionErrorAdvice {
  category: "authentication" | "authorization" | "validation" | "partial_failure" | "conflict" | "upstream" | "request";
  retryable: boolean;
  userAction: string;
}

export function actionErrorAdvice(code: string): ActionErrorAdvice {
  if (code === "UNAUTHORIZED") {
    return { category: "authentication", retryable: false, userAction: "Reconnect or re-authorize the action with a valid OAuth session." };
  }
  if (code === "OAUTH_WRITE_SCOPE_REQUIRED") {
    return { category: "authorization", retryable: false, userAction: "Reconnect with projects:write scope before retrying this write action." };
  }
  if (["PERMISSION_DENIED", "CAPABILITY_REQUIRED", "IDENTITY_REQUIRED", "PROJECT_MEMBERSHIP_DENIED", "PROJECT_WRITE_NOT_ALLOWED"].includes(code)) {
    return { category: "authorization", retryable: false, userAction: "Use an identity that has permission for this Project and operation, or ask an Admin/PM to perform it." };
  }
  if (["INVALID_INPUT", "INVALID_JSON", "IDENTITY_GITHUB_LOGIN_REQUIRED"].includes(code)) {
    return { category: "validation", retryable: false, userAction: "Correct the request input or identity mapping, then retry." };
  }
  if (code === "CREATE_WORK_ITEM_PARTIAL_FAILURE") {
    return { category: "partial_failure", retryable: false, userAction: "Do not create another Issue automatically. Inspect the Issue URL from the message and verify Project membership/status before deciding the next action." };
  }
  if (code === "AUDIT_PERSISTENCE_FAILED") {
    return { category: "partial_failure", retryable: false, userAction: "Do not retry the write automatically. Re-read the target state and restore durable audit availability before deciding the next action." };
  }
  if (code === "MUTATION_VERIFICATION_FAILED") {
    return { category: "conflict", retryable: false, userAction: "Re-read the affected Project item before retrying; the mutation result could be ambiguous." };
  }
  if (["REPOSITORY_NOT_FOUND", "PROJECT_ITEM_NOT_FOUND", "PROJECT_ITEM_LOOKUP_INCOMPLETE"].includes(code)) {
    return { category: "request", retryable: false, userAction: "Verify the repository, Project item, or URL target and retry with a valid resource." };
  }
  return { category: "upstream", retryable: true, userAction: "Retry once after re-reading current Project state. If it repeats, surface the error instead of looping." };
}

function errorPayload(code: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      ...actionErrorAdvice(code),
      ...extra,
    },
  };
}

function errorResponse(error: unknown, status = statusForError(error)): Response {
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  return json(errorPayload(code, message), status);
}

function unauthorized(): Response {
  return json(errorPayload("UNAUTHORIZED", "A valid OAuth bearer token with projects:read scope is required."), 401);
}

function writeScopeRequired(): Response {
  return json(errorPayload("OAUTH_WRITE_SCOPE_REQUIRED", "This REST operation requires OAuth scope projects:write."), 403);
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("INVALID_JSON: Request body must be valid JSON.");
  }
}

export async function handleRestApiRequest(request: Request, options: RestApiRuntimeOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return new Response("Not Found", { status: 404 });

  const token = bearerToken(request);
  if (!token) return unauthorized();

  const access = await oauthAccessTokenPayload(token);
  if (!access || !scopeIncludes(access.scope, OAUTH_READ_SCOPE)) return unauthorized();
  if (restPathRequiresWrite(url.pathname) && !scopeIncludes(access.scope, OAUTH_WRITE_SCOPE)) return writeScopeRequired();

  const baseConfig = options.config ?? loadConfig();
  const config = configForRemoteScope(baseConfig, access.scope);
  const principal = resolveRemotePrincipal(
    access.sub,
    config,
    options.identityRegistry ?? OAuthIdentityRegistry.fromEnvironment(),
  );
  if (!principal) return unauthorized();

  const client = options.client ?? new GitHubGraphQlClient(config.githubToken);
  const projects = new ProjectService({ config, client, principal });
  const snapshots = new SnapshotService(projects);
  const reads = new HighLevelReadService(snapshots);
  const identity = new IdentityContextService(principal);
  const workItems = new WorkItemService({ config, client, projects });
  const auditService = options.auditService ?? new AuditService(200);
  const writePolicy = new WritePolicy(config, principal);
  const writes = new HighLevelWriteService({
    client,
    projects,
    workItems,
    writePolicy,
    auditService,
  });
  const governance = createM10GovernanceServices({
    config,
    client,
    principal,
    projects,
    writePolicy,
    audit: auditService,
    bulkStore: options.bulkStore,
  });

  try {
    if (url.pathname === "/api/v1/identity") {
      if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
      return json({ ok: true, data: identity.getContext() });
    }

    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const body = await requestBody(request);

    if (url.pathname === "/api/v1/project/brief") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getProjectBrief(input.owner, input.number, input) });
    }
    if (url.pathname === "/api/v1/project/backlog") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getBacklog(input.owner, input.number, input) });
    }
    if (url.pathname === "/api/v1/project/review-queue") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getReviewQueue(input.owner, input.number, input) });
    }
    if (url.pathname === "/api/v1/project/unassigned") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getUnassignedWork(input.owner, input.number, input) });
    }
    if (url.pathname === "/api/v1/project/blockers") {
      const input = projectInput.parse(body);
      return json({ ok: true, data: await reads.getBlockers(input.owner, input.number, input) });
    }
    if (url.pathname === "/api/v1/project/my-work") {
      const input = myWorkInput.parse(body);
      const login = principal.githubLogin?.trim();
      if (!login) throw new Error(`IDENTITY_GITHUB_LOGIN_REQUIRED: Principal '${principal.id}' has no GitHub login mapping.`);
      return json({ ok: true, data: await reads.getMyWork(input.owner, input.number, { ...input, login }) });
    }
    if (url.pathname === "/api/v1/project/item-relationships") {
      const input = relationshipReadInput.parse(body);
      return json({ ok: true, data: await governance.relationships.getRelationships(input) });
    }
    if (url.pathname === "/api/v1/project/bulk-plan") {
      const input = bulkPlanGetInput.parse(body);
      return json({ ok: true, data: await governance.bulk.get(input.planId) });
    }

    if (url.pathname === "/api/v1/write/status") {
      const input = statusInput.parse(body);
      return json({ ok: true, data: await writes.updateWorkItemStatus(input.owner, input.number, input.itemId, input.status) });
    }
    if (url.pathname === "/api/v1/write/priority") {
      const input = priorityInput.parse(body);
      return json({ ok: true, data: await writes.updateWorkItemPriority(input.owner, input.number, input.itemId, input.priority) });
    }
    if (url.pathname === "/api/v1/write/start-work") {
      const input = writeTargetInput.parse(body);
      return json({ ok: true, data: await writes.startWork(input.owner, input.number, input.itemId) });
    }
    if (url.pathname === "/api/v1/write/assign") {
      const input = assignInput.parse(body);
      return json({ ok: true, data: await writes.assignWorkItem(input.owner, input.number, input.itemId, input.assigneeLogin) });
    }
    if (url.pathname === "/api/v1/write/capture-backlog") {
      const input = captureInput.parse(body);
      return json({ ok: true, data: await writes.captureBacklog(input.owner, input.number, input.url) });
    }
    if (url.pathname === "/api/v1/write/create-work-item") {
      const input = createInput.parse(body);
      return json({ ok: true, data: await writes.createWorkItem(input.owner, input.number, input.repository, input.title, input.body ?? null) });
    }
    const relationshipOperations = {
      "/api/v1/write/relationship/add-sub-issue": "add_sub_issue",
      "/api/v1/write/relationship/remove-sub-issue": "remove_sub_issue",
      "/api/v1/write/relationship/add-blocked-by": "add_blocked_by",
      "/api/v1/write/relationship/remove-blocked-by": "remove_blocked_by",
    } as const;
    const relationshipOperation = relationshipOperations[url.pathname as keyof typeof relationshipOperations];
    if (relationshipOperation) {
      const input = relationshipWriteInput.parse(body);
      return json({ ok: true, data: await governance.relationshipWrites.execute(relationshipOperation, input) });
    }
    if (url.pathname === "/api/v1/write/bulk/preview") {
      const input = bulkPreviewInput.parse(body);
      return json({ ok: true, data: await governance.bulk.preview(input.owner, input.number, input.operations) });
    }
    if (url.pathname === "/api/v1/write/bulk/approve") {
      const input = bulkPlanReferenceInput.parse(body);
      return json({ ok: true, data: await governance.bulk.approve(input.planId, input.planDigest) });
    }
    if (url.pathname === "/api/v1/write/bulk/apply") {
      const input = bulkPlanReferenceInput.parse(body);
      return json({ ok: true, data: await governance.bulk.apply(input.planId, input.planDigest) });
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(errorPayload("INVALID_INPUT", "Request input failed validation.", { issues: error.issues }), 400);
    }
    return errorResponse(error);
  }
}
