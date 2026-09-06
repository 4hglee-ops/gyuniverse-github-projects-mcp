const projectRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["owner", "number"],
  properties: {
    owner: { type: "string", minLength: 1, description: "GitHub organization or user that owns the Project." },
    number: { type: "integer", minimum: 1, description: "GitHub Project v2 number." },
    first: { type: "integer", minimum: 1, maximum: 100, default: 100 },
    includeArchived: { type: "boolean", default: false },
  },
} as const;

const writeTargetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["owner", "number", "itemId"],
  properties: {
    owner: { type: "string", minLength: 1 },
    number: { type: "integer", minimum: 1 },
    itemId: { type: "string", minLength: 1, description: "GitHub Project v2 item node ID." },
  },
} as const;

const actionsOwnerProperty = {
  type: "string", minLength: 1, maxLength: 100,
  description: "Project owner. Never infer this from the authenticated githubLogin. Omit only when the server has exactly one authorized owner.",
} as const;

const friendlyReferenceDescription = "Prefer the Issue/pull request URL or number the user supplied. Never invent a Project item ID. A number without a repository must be unique inside the authorized Project.";

const relationshipReadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["number"],
  anyOf: [
    { required: ["itemId"] },
    { required: ["url"] },
    { required: ["repository", "itemNumber"] },
    { required: ["itemNumber"] },
  ],
  properties: {
    owner: actionsOwnerProperty,
    number: { type: "integer", minimum: 1, description: "GitHub Project v2 number, not the Issue number." },
    itemId: { type: "string", minLength: 1, maxLength: 256, description: "Existing exact GitHub Project v2 item node ID. Use only when known; do not invent one." },
    url: { type: "string", format: "uri", maxLength: 2048, description: `Canonical GitHub Issue or pull request URL. ${friendlyReferenceDescription}` },
    repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", description: "Exact owner/repository paired with itemNumber." },
    itemNumber: { type: "integer", minimum: 1, description: `Issue or pull request number. ${friendlyReferenceDescription}` },
    first: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
} as const;

const relationshipWriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["number"],
  allOf: [
    { anyOf: [{ required: ["sourceItemId"] }, { required: ["sourceUrl"] },
      { required: ["sourceRepository", "sourceNumber"] }, { required: ["sourceNumber"] }] },
    { anyOf: [{ required: ["targetItemId"] }, { required: ["targetUrl"] },
      { required: ["targetRepository", "targetNumber"] }, { required: ["targetNumber"] }] },
  ],
  properties: {
    owner: actionsOwnerProperty,
    number: { type: "integer", minimum: 1, description: "GitHub Project v2 number, not an Issue number." },
    sourceItemId: { type: "string", minLength: 1, maxLength: 256, description: "Existing exact source Project item ID. Do not invent one." },
    sourceUrl: { type: "string", format: "uri", maxLength: 2048, description: `Source GitHub Issue or pull request URL. ${friendlyReferenceDescription}` },
    sourceRepository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", description: "Exact source owner/repository paired with sourceNumber." },
    sourceNumber: { type: "integer", minimum: 1, description: `Source Issue or pull request number. ${friendlyReferenceDescription}` },
    targetItemId: { type: "string", minLength: 1, maxLength: 256, description: "Existing exact target Project item ID. Do not invent one." },
    targetUrl: { type: "string", format: "uri", maxLength: 2048, description: `Target GitHub Issue or pull request URL. ${friendlyReferenceDescription}` },
    targetRepository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", description: "Exact target owner/repository paired with targetNumber." },
    targetNumber: { type: "integer", minimum: 1, description: `Target Issue or pull request number. ${friendlyReferenceDescription}` },
  },
} as const;

const bulkPlanReferenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planId", "planDigest"],
  properties: {
    planId: { type: "string", pattern: "^bulk-plan-[0-9a-f-]{36}$" },
    planDigest: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$", description: "Digest returned by the immutable preview." },
  },
} as const;

const bulkPreviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["number", "operations"],
  properties: {
    owner: actionsOwnerProperty,
    number: { type: "integer", minimum: 1, description: "GitHub Project v2 number, not an Issue number." },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value"],
        anyOf: [
          { required: ["itemId"] },
          { required: ["url"] },
          { required: ["repository", "number"] },
          { required: ["number"] },
        ],
        properties: {
          itemId: { type: "string", minLength: 1, maxLength: 256, description: "Existing exact Project item ID. Do not invent one." },
          url: { type: "string", format: "uri", maxLength: 2048, description: `GitHub Issue or pull request URL. ${friendlyReferenceDescription}` },
          repository: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", description: "Exact owner/repository paired with this operation's number." },
          number: { type: "integer", minimum: 1, description: `Issue or pull request number for this operation. ${friendlyReferenceDescription}` },
          field: { type: "string", enum: ["Status", "Priority"] },
          value: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
  },
} as const;

const jsonRequest = (schema: unknown) => ({ required: true, content: { "application/json": { schema } } });

const successResponse = {
  description: "Successful semantic Project response. Write responses include verification and same-operation actor/audit metadata when applicable.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["ok", "data"],
        properties: {
          ok: { type: "boolean", enum: [true] },
          data: { type: "object", additionalProperties: true },
        },
      },
    },
  },
};

const errorResponse = {
  description: "Action-safe error response. Use category/retryable/userAction instead of blindly repeating a failed write.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["ok", "error"],
        properties: {
          ok: { type: "boolean", enum: [false] },
          error: {
            type: "object",
            required: ["code", "message", "category", "retryable", "userAction"],
            properties: {
              code: { type: "string", description: "Stable machine-readable error code when available." },
              message: { type: "string", description: "Specific failure message. May include a created Issue URL for partial failures." },
              category: {
                type: "string",
                enum: ["authentication", "authorization", "validation", "partial_failure", "conflict", "upstream", "request"],
              },
              retryable: { type: "boolean", description: "Whether one automatic retry is considered safe after re-reading current state." },
              userAction: { type: "string", description: "Recommended next action for the assistant or user." },
              issues: { type: "array", description: "Validation details when code is INVALID_INPUT", items: { type: "object", additionalProperties: true } },
            },
          },
        },
      },
    },
  },
};

function readOperation(operationId: string, summary: string, schema: unknown = projectRequestSchema) {
  return {
    operationId,
    summary,
    security: [{ oauth2: ["projects:read"] }],
    requestBody: jsonRequest(schema),
    responses: { "200": successResponse, "400": errorResponse, "401": errorResponse, "403": errorResponse },
  };
}

function writeOperation(operationId: string, summary: string, schema: unknown, description: string) {
  return {
    operationId,
    summary,
    description,
    security: [{ oauth2: ["projects:read", "projects:write"] }],
    requestBody: jsonRequest(schema),
    responses: { "200": successResponse, "400": errorResponse, "401": errorResponse, "403": errorResponse },
  };
}

export function openApiDocument(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    openapi: "3.1.0",
    info: {
      title: "Gyuniverse GitHub Projects Operator API",
      version: "0.5.0",
      description: "Semantic REST adapter over the same Shared Core used by the Gyuniverse GitHub Projects MCP. GPT Actions should prefer user-supplied Issue/pull request URLs or numbers and must never invent internal Project item IDs or infer a Project owner from authenticated githubLogin. Friendly references resolve only inside the authorized Project. Guarded writes share OAuth identity, Project membership, ACL, verification, and audit rules with MCP.",
    },
    servers: [{ url: base }],
    paths: {
      "/api/v1/identity": {
        get: {
          operationId: "getIdentityContext",
          summary: "Get the authenticated Project operator identity and permissions.",
          security: [{ oauth2: ["projects:read"] }],
          responses: { "200": successResponse, "401": errorResponse },
        },
      },
      "/api/v1/project/brief": { post: readOperation("getProjectBrief", "Get an evidence-backed Project operating brief.") },
      "/api/v1/project/my-work": {
        post: readOperation("getMyWork", "Get work assigned to the authenticated GitHub identity.", {
          ...projectRequestSchema,
          properties: { ...projectRequestSchema.properties, includeDone: { type: "boolean", default: false } },
        }),
      },
      "/api/v1/project/backlog": { post: readOperation("getBacklog", "Get Project items whose Status is Backlog.") },
      "/api/v1/project/review-queue": { post: readOperation("getReviewQueue", "Get Project items whose Status is In Review.") },
      "/api/v1/project/unassigned": { post: readOperation("getUnassignedWork", "Get non-completed Project items with no assignee evidence.") },
      "/api/v1/project/blockers": { post: readOperation("getBlockers", "Get only explicitly evidenced Project blockers.") },
      "/api/v1/project/item-relationships": {
        post: readOperation(
          "get_github_project_item_relationships",
          "Read native parent, sub-issue, blocks and blocked-by relationships for one authorized Project Issue item.",
          relationshipReadSchema,
        ),
      },
      "/api/v1/project/bulk-plan": {
        post: readOperation(
          "get_github_project_bulk_plan",
          "Read an authorized durable M10 bulk plan and its lifecycle results.",
          { ...bulkPlanReferenceSchema, required: ["planId"] as const, properties: { planId: bulkPlanReferenceSchema.properties.planId } },
        ),
      },
      "/api/v1/write/status": {
        post: writeOperation(
          "updateWorkItemStatus",
          "Set one Project work item's Status by exact option name.",
          { ...writeTargetSchema, required: [...writeTargetSchema.required, "status"], properties: { ...writeTargetSchema.properties, status: { type: "string", minLength: 1 } } },
          "Idempotent semantic status write. On failure, inspect error.retryable and error.userAction before deciding whether to retry.",
        ),
      },
      "/api/v1/write/priority": {
        post: writeOperation(
          "updateWorkItemPriority",
          "Set one Project work item's Priority by exact option name.",
          { ...writeTargetSchema, required: [...writeTargetSchema.required, "priority"], properties: { ...writeTargetSchema.properties, priority: { type: "string", minLength: 1 } } },
          "Idempotent semantic priority write. Re-read state before any retry after an ambiguous verification failure.",
        ),
      },
      "/api/v1/write/start-work": {
        post: writeOperation("startWork", "Move one Project work item to In Progress.", writeTargetSchema, "Idempotent semantic transition to In Progress."),
      },
      "/api/v1/write/assign": {
        post: writeOperation(
          "assignWorkItem",
          "Add one GitHub assignee to the Issue or Pull Request represented by a Project item.",
          { ...writeTargetSchema, required: [...writeTargetSchema.required, "assigneeLogin"], properties: { ...writeTargetSchema.properties, assigneeLogin: { type: "string", minLength: 1 } } },
          "Additive assignment. Authorization policy may restrict this operation to Admin/PM identities.",
        ),
      },
      "/api/v1/write/capture-backlog": {
        post: writeOperation(
          "captureBacklog",
          "Capture an existing GitHub Issue or Pull Request URL into the Project and ensure Backlog status.",
          { type: "object", additionalProperties: false, required: ["owner", "number", "url"], properties: { owner: { type: "string", minLength: 1 }, number: { type: "integer", minimum: 1 }, url: { type: "string", format: "uri" } } },
          "Idempotent capture. Existing Project membership plus Backlog status returns a successful no_change result.",
        ),
      },
      "/api/v1/write/create-work-item": {
        post: writeOperation(
          "createWorkItem",
          "Create a GitHub Issue, capture it into the Project, and ensure Backlog status.",
          { type: "object", additionalProperties: false, required: ["owner", "number", "repository", "title"], properties: { owner: { type: "string", minLength: 1 }, number: { type: "integer", minimum: 1 }, repository: { type: "string", minLength: 1, description: "Repository name under the authorized Project owner." }, title: { type: "string", minLength: 1 }, body: { type: ["string", "null"] } } },
          "Creates a new Issue and is not idempotent by title/body. Never automatically retry CREATE_WORK_ITEM_PARTIAL_FAILURE; first inspect the Issue URL in the error message and current Project state to avoid duplicates.",
        ),
      },
      "/api/v1/write/relationship/add-sub-issue": {
        post: writeOperation(
          "add_github_project_sub_issue",
          "Add the target Issue as a sub-issue of the source Issue.",
          relationshipWriteSchema,
          "Admin-only single-edge write. Resolve both Issues only inside the same authorized Project; number-only references must be unique. Existing M10 relationship checks, global write gate, reciprocal verification and durable audit apply.",
        ),
      },
      "/api/v1/write/relationship/remove-sub-issue": {
        post: writeOperation(
          "remove_github_project_sub_issue",
          "Remove the target Issue from the source Issue's sub-issues.",
          relationshipWriteSchema,
          `Admin-only single-edge write. ${friendlyReferenceDescription} Does not delete either Issue; requires reciprocal verification and durable audit.`,
        ),
      },
      "/api/v1/write/relationship/add-blocked-by": {
        post: writeOperation(
          "add_github_project_blocked_by",
          "Make the source Issue blocked by the target Issue.",
          relationshipWriteSchema,
          "Admin-only single-edge write. Resolve both Issues only inside the same authorized Project; number-only references must be unique. Existing M10 cycle checks, global write gate, reciprocal verification and durable audit apply.",
        ),
      },
      "/api/v1/write/relationship/remove-blocked-by": {
        post: writeOperation(
          "remove_github_project_blocked_by",
          "Remove the source Issue's blocked-by relationship to the target Issue.",
          relationshipWriteSchema,
          `Admin-only single-edge write. ${friendlyReferenceDescription} Requires reciprocal verification and durable audit; do not retry a failed mutation blindly.`,
        ),
      },
      "/api/v1/write/bulk/preview": {
        post: writeOperation(
          "preview_github_project_bulk_updates",
          "Create an immutable preview for 1-20 Status/Priority updates in one authorized Project.",
          bulkPreviewSchema,
          "Admin-only governance action. Resolve every item reference inside the authorized Project before the immutable Preview is persisted; any resolution failure creates no plan. Preview does not mutate GitHub and requires bulk.preview, item capabilities, OAuth write scope and the global write gate.",
        ),
      },
      "/api/v1/write/bulk/approve": {
        post: writeOperation(
          "approve_github_project_bulk_plan",
          "Explicitly approve the exact immutable bulk plan identified by its ID and digest.",
          bulkPlanReferenceSchema,
          "Admin-only governance action. Enforces bulk.approve and the configured maker-checker policy; does not mutate GitHub.",
        ),
      },
      "/api/v1/write/bulk/apply": {
        post: writeOperation(
          "apply_github_project_bulk_plan",
          "Apply one approved bulk plan once after full preflight.",
          bulkPlanReferenceSchema,
          "Admin-only guarded write. A stale or unauthorized plan performs zero writes. Runtime partial failures are not rolled back or automatically retried; per-item durable audit is retained.",
        ),
      },
    },
    components: {
      schemas: {},
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${base}/oauth/authorize`,
              tokenUrl: `${base}/oauth/token`,
              scopes: {
                "projects:read": "Read authorized GitHub Projects and semantic Project state.",
                "projects:write": "Invoke authorized semantic Project writes subject to identity, ACL, allowlists, verification, and audit.",
              },
            },
          },
        },
      },
    },
  };
}
