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

const jsonRequest = (schema: unknown) => ({
  required: true,
  content: { "application/json": { schema } },
});

const successResponse = {
  description: "Successful semantic Project response.",
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
  description: "Authentication, authorization, validation, or Project policy error.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["ok", "error"],
        properties: {
          ok: { type: "boolean", enum: [false] },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
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
    responses: {
      "200": successResponse,
      "400": errorResponse,
      "401": errorResponse,
    },
  };
}

export function openApiDocument(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    openapi: "3.1.0",
    info: {
      title: "Gyuniverse GitHub Projects Operator API",
      version: "0.1.0",
      description: "Semantic REST adapter over the same Shared Core used by the Gyuniverse GitHub Projects MCP. M9 starts read-only; write operations are added in later M9 slices.",
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
      "/api/v1/project/brief": {
        post: readOperation("getProjectBrief", "Get an evidence-backed Project operating brief."),
      },
      "/api/v1/project/my-work": {
        post: readOperation("getMyWork", "Get work assigned to the authenticated GitHub identity.", {
          ...projectRequestSchema,
          properties: {
            ...projectRequestSchema.properties,
            includeDone: { type: "boolean", default: false },
          },
        }),
      },
      "/api/v1/project/backlog": {
        post: readOperation("getBacklog", "Get Project items whose Status is Backlog."),
      },
      "/api/v1/project/review-queue": {
        post: readOperation("getReviewQueue", "Get Project items whose Status is In Review."),
      },
      "/api/v1/project/unassigned": {
        post: readOperation("getUnassignedWork", "Get non-completed Project items with no assignee evidence."),
      },
      "/api/v1/project/blockers": {
        post: readOperation("getBlockers", "Get only explicitly evidenced Project blockers."),
      },
    },
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${base}/oauth/authorize`,
              tokenUrl: `${base}/oauth/token`,
              scopes: {
                "projects:read": "Read authorized GitHub Projects and semantic Project state.",
                "projects:write": "Invoke authorized semantic Project writes when exposed by the API.",
              },
            },
          },
        },
      },
    },
  };
}
