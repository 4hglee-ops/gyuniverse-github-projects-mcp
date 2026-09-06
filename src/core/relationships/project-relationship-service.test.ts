import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../config.js";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { principalForRole } from "../identity/principal.js";
import { ProjectService } from "../projects/project-service.js";
import { ProjectRelationshipService } from "./project-relationship-service.js";

const config: AppConfig = { githubToken: "test", allowedOwners: ["gyuniverse-hq"], allowedProjectIds: ["PVT"], writeEnabled: false };
const input = { owner: "gyuniverse-hq", number: 2, itemId: "ITEM1" };
const issue = (n: number, owner = "gyuniverse-hq") => ({ id: `ITEM${n}`, content: {
  __typename: "Issue", id: `ISSUE${n}`, number: n, title: `Issue ${n}`,
  url: `https://github.com/${owner}/repo/issues/${n}`, state: "OPEN", repository: { nameWithOwner: `${owner}/repo` },
} });
const connection = (ids: string[] = [], more = false) => ({ nodes: ids.map((id) => ({ id })), totalCount: ids.length + (more ? 1 : 0), pageInfo: { hasNextPage: more, endCursor: more ? "next" : null } });
const relations = (overrides: Record<string, unknown> = {}) => ({ node: { __typename: "Issue", id: "ISSUE1", parent: null,
  subIssues: connection(), blocking: connection(), blockedBy: connection(), ...overrides } });
const inventory = (nodes: unknown[] = [issue(1), issue(2)], next: string | null = null) => ({ node: { __typename: "ProjectV2", id: "PVT", items: {
  nodes, pageInfo: { hasNextPage: next !== null, endCursor: next },
} } });

function fixture(options: {
  inventory?: (variables: Record<string, unknown>, page: number) => unknown;
  relations?: unknown; config?: AppConfig; projectIds?: string[]; noRead?: boolean;
} = {}) {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  let page = 0;
  class Client extends GitHubGraphQlClient {
    override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      assert.ok(!/\bmutation\b/.test(query), "relationship reads must never mutate");
      calls.push({ query, variables });
      if (query.includes("RelationshipProjectItems")) return (options.inventory?.(variables, ++page) ?? inventory()) as T;
      if (query.includes("IssueRelationships")) return (options.relations ?? relations()) as T;
      return { repositoryOwner: { projectV2: { id: "PVT" } } } as T;
    }
  }
  const client = new Client("test");
  const principal = principalForRole("actor", "viewer", { githubLogin: "4hglee-ops", projectIds: options.projectIds ?? ["PVT"] });
  if (options.noRead) principal.permissions = [];
  const cfg = options.config ?? config;
  const projects = new ProjectService({ config: cfg, client, principal });
  return { service: new ProjectRelationshipService({ config: cfg, client, projects }), calls };
}

test("empty native relationships are explicit, read-only, and owner is not actor login", async () => {
  const { service, calls } = fixture();
  const result = await service.getRelationships(input);
  for (const key of ["parent", "subIssues", "blocks", "blockedBy"] as const) {
    assert.deepEqual(result[key].targets, []);
    assert.equal(result[key].coverage.complete, true);
  }
  assert.equal(calls[0]!.variables.login, "gyuniverse-hq");
  assert.equal(result.coverage.firstPerRelationship, 50);
  assert.equal(calls.length, 3);
});

for (const [apiField, outputField] of [["parent", "parent"], ["subIssues", "subIssues"], ["blocking", "blocks"], ["blockedBy", "blockedBy"]] as const) {
  test(`native ${apiField} maps to ${outputField} without reversing direction`, async () => {
    const { service } = fixture({ relations: relations({ [apiField]: apiField === "parent" ? { id: "ISSUE2" } : connection(["ISSUE2"]) }) });
    const result = await service.getRelationships(input);
    assert.equal(result.source.contentId, "ISSUE1");
    assert.equal(result[outputField].targets[0]!.contentId, "ISSUE2");
    assert.equal(result[outputField].targets[0]!.insideAuthorizedProject, true);
  });
}

test("multiple targets preserve native order, closed state and explicit coverage", async () => {
  const closed = issue(3); closed.content.state = "CLOSED";
  const { service } = fixture({ inventory: () => inventory([issue(1), issue(2), closed]), relations: relations({ blocking: connection(["ISSUE3", "ISSUE2"]) }) });
  const result = await service.getRelationships(input);
  assert.deepEqual(result.blocks.targets.map((target) => target.state), ["CLOSED", "OPEN"]);
  assert.equal(result.blocks.coverage.complete, true);
});

test("outside-Project IDs and unapproved owner details are withheld, including parent", async () => {
  const { service } = fixture({ inventory: () => inventory([issue(1), issue(2, "private-owner")]),
    relations: relations({ parent: { id: "PRIVATE_ID" }, blockedBy: connection(["PRIVATE_ID", "ISSUE2"]) }) });
  const result = await service.getRelationships(input);
  assert.deepEqual(result.blockedBy.coverage.withheld, { outsideProject: 1, membershipUnverified: 0, repositoryOwnerNotAllowed: 1 });
  assert.equal(result.parent.coverage.complete, false);
  assert.equal(result.parent.coverage.totalCount, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_ID"));
  assert.ok(!JSON.stringify(result).includes("private-owner"));
});

test("owner, Project allowlist, membership and read permission reject before content queries", async () => {
  for (const options of [{ config: { ...config, allowedOwners: ["elsewhere"] } },
    { config: { ...config, allowedProjectIds: ["other"] } }, { projectIds: [] }, { noRead: true }]) {
    const { service, calls } = fixture(options);
    await assert.rejects(() => service.getRelationships(input));
    assert.ok(calls.every((call) => !call.query.includes("Relationship")));
  }
});

test("unsupported, inaccessible, absent and disallowed source fail before relationship fetch", async () => {
  for (const [nodes, pattern] of [
    [[{ id: "ITEM1", content: { __typename: "PullRequest" } }], /SOURCE_UNSUPPORTED/],
    [[{ id: "ITEM1", content: { __typename: "DraftIssue" } }], /SOURCE_UNSUPPORTED/],
    [[{ id: "ITEM1", content: null }], /CONTENT_INACCESSIBLE/],
    [[], /ITEM_NOT_FOUND/], [[issue(1, "private-owner")], /owner is not allowed/],
  ] as const) {
    const { service, calls } = fixture({ inventory: () => inventory([...nodes]) });
    await assert.rejects(() => service.getRelationships(input), pattern);
    assert.ok(calls.every((call) => !call.query.includes("IssueRelationships")));
  }
});

test("Project pagination resolves source and targets on subsequent pages", async () => {
  const { service, calls } = fixture({ inventory: (variables) => variables.after ? inventory([issue(1), issue(2)]) : inventory([issue(3)], "page2"),
    relations: relations({ subIssues: connection(["ISSUE2"]) }) });
  const result = await service.getRelationships(input);
  assert.equal(result.coverage.projectInventory.pagesScanned, 2);
  assert.equal(result.subIssues.targets.length, 1);
  assert.equal(calls[2]!.variables.after, "page2");
});

test("Project scan stops after ten pages and marks unverified membership, not outside Project", async () => {
  const { service } = fixture({ inventory: (_variables, page) => inventory([issue(page)], `p${page}`),
    relations: relations({ blockedBy: connection(["UNSEEN"]) }) });
  const result = await service.getRelationships(input);
  assert.equal(result.coverage.projectInventory.pagesScanned, 10);
  assert.equal(result.coverage.projectInventory.complete, false);
  assert.equal(result.blockedBy.coverage.withheld.membershipUnverified, 1);
});

test("null Project content prevents exhaustive absence claims", async () => {
  const { service } = fixture({ inventory: () => inventory([issue(1), { id: "HIDDEN", content: null }]), relations: relations({ blockedBy: connection(["UNSEEN"]) }) });
  const result = await service.getRelationships(input);
  assert.equal(result.coverage.projectInventory.inaccessibleItems, 1);
  assert.equal(result.blockedBy.coverage.withheld.membershipUnverified, 1);
  await assert.rejects(() => service.getRelationships({ ...input, itemId: "UNSEEN" }), /LOOKUP_INCOMPLETE/);
});

test("bounded relationship first page reports truncation and never silently exhausts", async () => {
  const { service, calls } = fixture({ relations: relations({ subIssues: connection(["ISSUE2"], true) }) });
  const result = await service.getRelationships({ ...input, first: 1 });
  assert.equal(result.subIssues.coverage.totalCount, 2);
  assert.equal(result.subIssues.coverage.hasNextPage, true);
  assert.equal(result.subIssues.coverage.complete, false);
  assert.equal(calls[2]!.variables.first, 1);
  for (const first of [0, 101, 1.5]) await assert.rejects(() => service.getRelationships({ ...input, first }));
});

test("malformed or mismatched relationship data fails closed without response body leakage", async () => {
  for (const value of [relations({ id: "WRONG" }), relations({ parent: undefined }), relations({ blockedBy: null }),
    relations({ subIssues: { ...connection(), nodes: [null] } }),
    relations({ blocking: connection(["ISSUE2", "ISSUE2"]) }),
    relations({ blockedBy: { ...connection(), totalCount: 9 } }), { node: null }]) {
    const { service } = fixture({ relations: value });
    await assert.rejects(() => service.getRelationships(input), /RELATIONSHIP_RESPONSE_INVALID/);
  }
});

test("malformed Project nodes, forged URL, wrong Project and repeated cursor fail closed", async () => {
  const forged = issue(1); forged.content.url = "https://evil.example/secret";
  for (const handler of [() => inventory([null]), () => inventory([forged]),
    () => ({ node: { ...inventory().node, id: "WRONG" } }),
    (_vars: Record<string, unknown>, page: number) => inventory([issue(page)], "same"),
    () => inventory([issue(1), issue(1)])]) {
    const { service } = fixture({ inventory: handler });
    await assert.rejects(() => service.getRelationships(input), /RELATIONSHIP_RESPONSE_INVALID/);
  }
});

test("GitHub API failures propagate instead of manufacturing empty relationships", async () => {
  const { service } = fixture({ inventory: () => { throw new Error("GitHub unavailable"); } });
  await assert.rejects(() => service.getRelationships(input), /GitHub unavailable/);
});
