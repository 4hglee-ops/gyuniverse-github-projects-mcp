import assert from "node:assert/strict";
import test from "node:test";

import { AuditService } from "../core/audit/audit-service.js";
import { MemoryWriteAuditStore } from "../core/audit/audit-store.js";
import type { BulkPlan } from "../core/bulk/bulk-plan.js";
import { MemoryBulkPlanStore } from "../core/bulk/bulk-plan-store.js";
import { OAuthIdentityRegistry } from "../core/identity/oauth-identity-registry.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { signEnvelope } from "../oauth/stateless.js";
import { handleRestApiRequest } from "./rest-api.js";

const baseUrl = "https://actions-test.example";
const config = {
  githubToken: "test-github-token-never-log",
  allowedOwners: ["gyuniverse-hq"],
  allowedProjectIds: ["PVT"],
  writeEnabled: true,
  bulkApprovalMode: "same_admin_allowed" as const,
};
const registry = new OAuthIdentityRegistry(["viewer", "member", "admin"].map((role) => ({
  subject: `user:${role}`,
  accessCode: `test-access-code-${role}`,
  githubLogin: "4hglee-ops",
  role: role as "viewer" | "member" | "admin",
  projectIds: ["PVT"],
})));

class ActionsClient extends GitHubGraphQlClient {
  mutations = 0;
  subIssue = true;
  blockedBy = false;
  projectLogins: string[] = [];

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (query.includes("mutation GuardedIssueRelationship")) {
      this.mutations++;
      if (query.includes("result: addSubIssue")) this.subIssue = true;
      if (query.includes("result: removeSubIssue")) this.subIssue = false;
      if (query.includes("result: addBlockedBy")) this.blockedBy = true;
      if (query.includes("result: removeBlockedBy")) this.blockedBy = false;
      return { result: { issue: { id: "I1" }, target: { id: "I2" } } } as T;
    }
    if (/\bmutation\b/.test(query)) {
      this.mutations++;
      throw new Error("Unexpected non-relationship mutation in Actions regression test.");
    }
    if (query.includes("ProjectItemReferenceInventory")) {
      return { node: { __typename: "ProjectV2", id: "PVT", items: { nodes: [
        { id: "ITEM1", type: "ISSUE", content: { __typename: "Issue", id: "I1", title: "Source", number: 8, url: "https://github.com/gyuniverse-hq/repo/issues/8", repository: { nameWithOwner: "gyuniverse-hq/repo" } } },
        { id: "ITEM2", type: "ISSUE", content: { __typename: "Issue", id: "I2", title: "Target", number: 9, url: "https://github.com/gyuniverse-hq/repo/issues/9", repository: { nameWithOwner: "gyuniverse-hq/repo" } } },
      ], pageInfo: { hasNextPage: false, endCursor: null } } } } as T;
    }
    if (query.includes("RelationshipProjectItems")) {
      return { node: { __typename: "ProjectV2", id: "PVT", items: { nodes: [
        { id: "ITEM1", content: { __typename: "Issue", id: "I1", title: "Source", number: 8, state: "OPEN", url: "https://github.com/gyuniverse-hq/repo/issues/8", repository: { nameWithOwner: "gyuniverse-hq/repo" } } },
        { id: "ITEM2", content: { __typename: "Issue", id: "I2", title: "Target", number: 9, state: "OPEN", url: "https://github.com/gyuniverse-hq/repo/issues/9", repository: { nameWithOwner: "gyuniverse-hq/repo" } } },
      ], pageInfo: { hasNextPage: false, endCursor: null } } } } as T;
    }
    if (query.includes("IssueRelationships")) {
      const issueId = variables.issueId;
      const connection = (target: string | null) => ({
        nodes: target ? [{ id: target }] : [],
        totalCount: target ? 1 : 0,
        pageInfo: { hasNextPage: false, endCursor: null },
      });
      return { node: {
        __typename: "Issue",
        id: issueId,
        parent: issueId === "I2" && this.subIssue ? { id: "I1" } : null,
        subIssues: connection(issueId === "I1" && this.subIssue ? "I2" : null),
        blockedBy: connection(issueId === "I1" && this.blockedBy ? "I2" : null),
        blocking: connection(issueId === "I2" && this.blockedBy ? "I1" : null),
      } } as T;
    }
    if (query.includes("fieldValueByName")) {
      return { node: {
        __typename: "ProjectV2Item",
        id: variables.itemId,
        project: { id: "PVT", number: 2, title: "Actions test" },
        fieldValueByName: { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "Todo", optionId: "OPT_TODO" },
      } } as T;
    }
    if (query.includes("fields(first: 100)")) {
      return { repositoryOwner: { projectV2: { fields: { nodes: [{
        __typename: "ProjectV2SingleSelectField",
        id: "FIELD_STATUS",
        name: "Status",
        dataType: "SINGLE_SELECT",
        options: [{ id: "OPT_TODO", name: "Todo" }],
      }] } } } } as T;
    }
    if (typeof variables.login === "string") this.projectLogins.push(variables.login);
    return { repositoryOwner: { projectV2: {
      id: "PVT", number: 2, title: "Actions test", shortDescription: null, readme: null,
      url: "https://github.com/orgs/gyuniverse-hq/projects/2", closed: false, public: false,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    } } } as T;
  }
}

class CountingBulkPlanStore extends MemoryBulkPlanStore {
  creates = 0;
  override async create(plan: BulkPlan): Promise<void> {
    this.creates++;
    await super.create(plan);
  }
}

test("GPT Actions M10 routes reuse runtime Viewer/Member/Admin ACL and durable audit boundaries", { timeout: 20_000 }, async () => {
  const previousBase = process.env.PUBLIC_BASE_URL;
  const previousSecret = process.env.MCP_OAUTH_SIGNING_SECRET;
  process.env.PUBLIC_BASE_URL = baseUrl;
  process.env.MCP_OAUTH_SIGNING_SECRET = "test-signing-secret-never-log";
  const client = new ActionsClient(config.githubToken);
  const audit = new AuditService(200, new MemoryWriteAuditStore(200));
  const bulkStore = new CountingBulkPlanStore();

  const call = async (
    role: "viewer" | "member" | "admin",
    path: string,
    body: object,
    scope = "projects:read projects:write",
    runtimeConfig = config,
  ) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signEnvelope("gypa", {
      typ: "access_token", aud: `${baseUrl}/mcp`, sub: `user:${role}`,
      scope, iat: now, exp: now + 60,
    });
    return handleRestApiRequest(new Request(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }), { config: runtimeConfig, client, identityRegistry: registry, auditService: audit, bulkStore });
  };

  try {
    const relationshipInput = { owner: "gyuniverse-hq", number: 2, sourceItemId: "ITEM1", targetItemId: "ITEM2" };
    const viewerRead = await call("viewer", "/api/v1/project/item-relationships", {
      owner: "gyuniverse-hq", number: 2, itemId: "ITEM1",
    }, "projects:read");
    assert.equal(viewerRead.status, 200);
    assert.equal((await viewerRead.json() as { data: { source: { itemId: string } } }).data.source.itemId, "ITEM1");

    const friendlyViewerRead = await call("viewer", "/api/v1/project/item-relationships", {
      number: 2, itemNumber: 8,
    }, "projects:read");
    assert.equal(friendlyViewerRead.status, 200);
    assert.equal((await friendlyViewerRead.json() as { data: { source: { itemId: string } } }).data.source.itemId, "ITEM1");

    const ownerRequired = await call("viewer", "/api/v1/project/item-relationships", {
      number: 2, itemNumber: 8,
    }, "projects:read", { ...config, allowedOwners: ["gyuniverse-hq", "another-owner"] });
    assert.equal(ownerRequired.status, 400);
    assert.equal((await ownerRequired.json() as { error: { code: string } }).error.code, "PROJECT_OWNER_REQUIRED");

    const scopeDenied = await call("admin", "/api/v1/write/relationship/add-sub-issue", relationshipInput, "projects:read");
    assert.equal(scopeDenied.status, 403);
    assert.equal((await scopeDenied.json() as { error: { code: string } }).error.code, "OAUTH_WRITE_SCOPE_REQUIRED");

    for (const role of ["viewer", "member"] as const) {
      const denied = await call(role, "/api/v1/write/relationship/add-sub-issue", {
        owner: "gyuniverse-hq", number: 2, sourceNumber: 8, targetNumber: 9,
      });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json() as { error: { code: string } }).error.code, "PERMISSION_DENIED");
    }

    const relationshipRoutes = [
      ["/api/v1/write/relationship/add-sub-issue", "add_sub_issue", "no_change", { owner: "gyuniverse-hq", number: 2, sourceNumber: 8, targetNumber: 9 }],
      ["/api/v1/write/relationship/remove-sub-issue", "remove_sub_issue", "success", { owner: "gyuniverse-hq", number: 2, sourceUrl: "https://github.com/gyuniverse-hq/repo/issues/8", targetRepository: "gyuniverse-hq/repo", targetNumber: 9 }],
      ["/api/v1/write/relationship/add-blocked-by", "add_blocked_by", "success", { owner: "gyuniverse-hq", number: 2, sourceRepository: "gyuniverse-hq/repo", sourceNumber: 8, targetUrl: "https://github.com/gyuniverse-hq/repo/issues/9" }],
      ["/api/v1/write/relationship/remove-blocked-by", "remove_blocked_by", "success", { owner: "gyuniverse-hq", number: 2, sourceNumber: 8, targetNumber: 9 }],
    ] as const;
    type RelationshipActionResult = { operation: string; outcome: string; actorId: string; auditPersistence: string };
    let relationshipData: RelationshipActionResult | null = null;
    for (const [path, expectedOperation, expectedOutcome, friendlyInput] of relationshipRoutes) {
      const relationship = await call("admin", path, friendlyInput);
      assert.equal(relationship.status, 200, path);
      relationshipData = (await relationship.json() as { data: RelationshipActionResult }).data;
      assert.equal(relationshipData?.operation, expectedOperation);
      assert.equal(relationshipData?.outcome, expectedOutcome);
      assert.equal(relationshipData?.actorId, "user:admin");
      assert.equal(relationshipData?.auditPersistence, "process-local");
    }

    const memberBulk = await call("member", "/api/v1/write/bulk/preview", {
      owner: "gyuniverse-hq", number: 2, operations: [{ itemId: "ITEM1", field: "Status", value: "Todo" }],
    });
    assert.equal(memberBulk.status, 403);
    assert.equal((await memberBulk.json() as { error: { code: string } }).error.code, "PERMISSION_DENIED");

    const createsBeforeFailure = bulkStore.creates;
    const mutationsBeforeFailure = client.mutations;
    const failedResolution = await call("admin", "/api/v1/write/bulk/preview", {
      owner: "gyuniverse-hq", number: 2, operations: [{ number: 404, field: "Status", value: "Todo" }],
    });
    assert.equal(failedResolution.status, 400);
    assert.equal((await failedResolution.json() as { error: { code: string } }).error.code, "PROJECT_ITEM_NOT_FOUND");
    assert.equal(bulkStore.creates, createsBeforeFailure);
    assert.equal(client.mutations, mutationsBeforeFailure);

    const preview = await call("admin", "/api/v1/write/bulk/preview", {
      owner: "gyuniverse-hq", number: 2, operations: [
        { number: 8, field: "Status", value: "Todo" },
        { number: 9, field: "Status", value: "Todo" },
      ],
    });
    assert.equal(preview.status, 200);
    const plan = (await preview.json() as { data: { planId: string; planDigest: string; state: string } }).data;
    assert.equal(plan.state, "previewed");

    const approve = await call("admin", "/api/v1/write/bulk/approve", { planId: plan.planId, planDigest: plan.planDigest });
    assert.equal(approve.status, 200);
    assert.equal((await approve.json() as { data: { state: string } }).data.state, "approved");

    const apply = await call("admin", "/api/v1/write/bulk/apply", { planId: plan.planId, planDigest: plan.planDigest });
    assert.equal(apply.status, 200);
    assert.equal((await apply.json() as { data: { state: string; results: Array<{ outcome: string }> } }).data.results[0]?.outcome, "no_change");

    const get = await call("admin", "/api/v1/project/bulk-plan", { planId: plan.planId }, "projects:read");
    assert.equal(get.status, 200);
    assert.equal((await get.json() as { data: { state: string } }).data.state, "completed");

    const entries = (await audit.list()).entries;
    assert.equal(entries.length, 6);
    assert.equal(entries.some((entry) => entry.capability === "item.relationship.write"), true);
    assert.equal(entries.some((entry) => entry.capability === "item.update_status" && entry.planId === plan.planId), true);
    assert.equal(entries.some((entry) => entry.itemId === "ITEM1"), true);
    assert.equal(entries.some((entry) => entry.itemId === "ITEM2"), true);
    assert.equal(client.mutations, 3);
    assert.equal(client.projectLogins.includes("4hglee-ops"), false);
    assert.equal(client.projectLogins.every((login) => login === "gyuniverse-hq"), true);

    const boundedEvidence = JSON.stringify({ entries, relationshipData, plan });
    for (const secret of [config.githubToken, process.env.MCP_OAUTH_SIGNING_SECRET!, "test-access-code-admin"]) {
      assert.doesNotMatch(boundedEvidence, new RegExp(secret));
    }
  } finally {
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previousBase;
    if (previousSecret === undefined) delete process.env.MCP_OAUTH_SIGNING_SECRET; else process.env.MCP_OAUTH_SIGNING_SECRET = previousSecret;
  }
});
