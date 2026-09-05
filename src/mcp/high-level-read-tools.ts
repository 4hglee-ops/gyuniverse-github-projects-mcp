import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ProjectChangeService } from "../core/changes/project-change-service.js";
import { IdentityContextService } from "../core/identity/identity-context-service.js";
import type { AuthenticatedPrincipal } from "../core/identity/principal.js";
import { HighLevelReadService } from "../core/reads/high-level-read-service.js";

interface RegisterHighLevelReadToolsOptions {
  server: McpServer;
  reads: HighLevelReadService;
  changes: ProjectChangeService;
  principal?: AuthenticatedPrincipal | null;
  json: (value: unknown) => { content: Array<{ type: "text"; text: string }> };
}

const projectInput = z.object({
  owner: z.string().min(1),
  number: z.number().int().min(1),
  first: z.number().int().min(1).max(100).default(100),
  includeArchived: z.boolean().default(false),
});

export function resolveMyWorkLogin(
  principal: AuthenticatedPrincipal | null | undefined,
  requestedLogin?: string,
): string {
  const explicit = requestedLogin?.trim() || null;
  if (!principal) {
    if (!explicit) throw new Error("login is required for get_my_work when no authenticated identity is available.");
    return explicit;
  }

  const identityLogin = principal.githubLogin?.trim() || null;
  if (!identityLogin) {
    throw new Error(`IDENTITY_GITHUB_LOGIN_REQUIRED: Principal '${principal.id}' has no GitHub login mapping.`);
  }
  if (explicit && explicit.toLowerCase() !== identityLogin.toLowerCase()) {
    throw new Error(
      `IDENTITY_LOGIN_MISMATCH: get_my_work is bound to authenticated GitHub login '${identityLogin}'.`,
    );
  }
  return identityLogin;
}

export function registerHighLevelReadTools({
  server,
  reads,
  changes,
  principal = null,
  json,
}: RegisterHighLevelReadToolsOptions): void {
  const identity = new IdentityContextService(principal);

  server.registerTool(
    "get_identity_context",
    {
      description: "Return the current authenticated operator identity, role, permissions, and Project memberships without exposing access codes, bearer tokens, or secrets.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => json(identity.getContext()),
  );

  server.registerTool(
    "get_project_brief",
    {
      description: "Return a concise evidence-backed Project operating brief with status/priority counts, in-progress work, review queue, unassigned work, and explicit blockers.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getProjectBrief(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_my_work",
    {
      description: "Return work assigned to the authenticated GitHub identity. The optional login is accepted only as a compatibility assertion and cannot override authenticated identity.",
      inputSchema: projectInput.extend({
        login: z.string().min(1).optional(),
        includeDone: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived, login, includeDone }) => {
      const effectiveLogin = resolveMyWorkLogin(principal, login);
      return json(await reads.getMyWork(owner, number, {
        first,
        includeArchived,
        login: effectiveLogin,
        includeDone,
      }));
    },
  );

  server.registerTool(
    "get_backlog",
    {
      description: "Return items whose Project Status is explicitly Backlog.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getBacklog(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_review_queue",
    {
      description: "Return items whose Project Status is explicitly In Review.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getReviewQueue(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_unassigned_work",
    {
      description: "Return non-completed Project items with no repository or Project assignee evidence.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getUnassignedWork(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_blockers",
    {
      description: "Return only explicitly evidenced blockers from Blocked status/fields/reasons; does not infer blockers from ordinary workflow state.",
      inputSchema: projectInput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ owner, number, first, includeArchived }) => json(
      await reads.getBlockers(owner, number, { first, includeArchived }),
    ),
  );

  server.registerTool(
    "get_project_changes",
    {
      description: "Compare the current Project snapshot with the shared process-local baseline and return semantic change groups without replacing the baseline. Can initialize a missing baseline explicitly.",
      inputSchema: z.object({
        owner: z.string().min(1),
        number: z.number().int().min(1),
        first: z.number().int().min(1).max(100).default(100),
        initializeIfMissing: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ owner, number, first, initializeIfMissing }) => json(
      await changes.getChanges(owner, number, { first, initializeIfMissing }),
    ),
  );
}
