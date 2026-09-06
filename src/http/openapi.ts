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
      version: "0.3.1",
      description: "Semantic REST adapter over the same Shared Core used by the Gyuniverse GitHub Projects MCP. Guarded writes share OAuth identity, Project membership, ACL, verification, and audit rules with MCP. Failed writes return action guidance; partial failures must not be blindly retried.",
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
