import assert from "node:assert/strict";
import test from "node:test";
import { GitHubGraphQlClient } from "../../github/graphql-client.js";
import { principalForRole } from "../identity/principal.js";
import { projectViewCatalog } from "./project-view-catalog.js";

const config = { githubToken: "synthetic-unused", allowedOwners: ["fixture-org"], allowedProjectIds: ["A", "B"], writeEnabled: true };
const project = (id: string, owner = "fixture-org") => ({ id, number: 3, title: "Fixture", owner: { login: owner }, viewerCanUpdate: true });
class Client extends GitHubGraphQlClient {
  ids: unknown;
  constructor(private readonly nodes: unknown[]) { super("synthetic-unused"); }
  override async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    assert.match(query, /query ProjectViewCatalog/); assert.doesNotMatch(query, /mutation/);
    this.ids = variables.ids; return { nodes: this.nodes } as T;
  }
}
test("View catalog queries only the server/member/read-capability intersection", async () => {
  const principal = { ...principalForRole("admin", "admin", { projectIds: ["A", "B", "OTHER"] }),
    resourcePermissions: { A: ["project.read", "project.write", "project.view.write"] as const, B: [] } };
  const scoped = { ...principal, resourcePermissions: { A: [...principal.resourcePermissions.A], B: [] } };
  const client = new Client([project("A")]);
  const catalog = await projectViewCatalog(config, client, scoped);
  assert.deepEqual(client.ids, ["A"]);
  assert.equal(catalog.projects[0]!.canWriteViews, true);
  assert.equal(catalog.omittedProjectCount, 0);
});
test("View catalog preserves read-only scope, roles, capability ceilings and upstream revocation", async () => {
  for (const role of ["viewer", "member", "admin"] as const) {
    const p = principalForRole(role, role, { projectIds: ["A"] });
    assert.equal((await projectViewCatalog(config, new Client([project("A")]), p)).projects[0]!.canWriteViews, role === "admin");
    assert.equal((await projectViewCatalog({ ...config, writeEnabled: false }, new Client([project("A")]), p)).projects[0]!.canWriteViews, false);
  }
  const admin = principalForRole("admin", "admin", { projectIds: ["A"] });
  const narrowed = { ...admin, resourcePermissions: { A: ["project.read", "project.write"] as ("project.read" | "project.write")[] } };
  assert.equal((await projectViewCatalog(config, new Client([project("A")]), narrowed)).projects[0]!.canWriteViews, false);
  assert.equal((await projectViewCatalog(config, new Client([{ ...project("A"), viewerCanUpdate: false }]), admin)).projects[0]!.canWriteViews, false);
});
test("Catalog omits inaccessible/disallowed-owner Projects and rejects forged, duplicate and incomplete responses", async () => {
  const p = principalForRole("admin", "admin", { projectIds: ["A", "B"] });
  assert.deepEqual(await projectViewCatalog(config, new Client([null, project("B", "other-org")]), p), { projects: [], omittedProjectCount: 2 });
  for (const nodes of [[project("OTHER"), null], [project("A"), project("A")], [project("A")], [{}]]) {
    await assert.rejects(() => projectViewCatalog(config, new Client(nodes), p), /PROJECT_CATALOG_UNAVAILABLE/);
  }
  await assert.rejects(() => projectViewCatalog({ ...config, allowedOwners: [] }, new Client([]), p), /PROJECT_CATALOG_UNAVAILABLE/);
  await assert.rejects(() => projectViewCatalog({ ...config, allowedProjectIds: [] }, new Client([]), p), /PROJECT_CATALOG_UNAVAILABLE/);
});
test("Empty or oversized catalog scopes do not fetch Projects and upstream failures expose no private detail", async () => {
  const client = new Client([]);
  assert.deepEqual(await projectViewCatalog(config, client, principalForRole("viewer", "viewer")), { projects: [], omittedProjectCount: 0 });
  assert.equal(client.ids, undefined);
  const ids = Array.from({ length: 101 }, (_, i) => "P" + i);
  await assert.rejects(() => projectViewCatalog({ ...config, allowedProjectIds: ids }, client,
    principalForRole("admin", "admin", { projectIds: ids })), /PROJECT_CATALOG_UNAVAILABLE/);
  assert.equal(client.ids, undefined);
  class FailedClient extends Client {
    override async request<T>(): Promise<T> { throw new Error("private-upstream-response"); }
  }
  await assert.rejects(() => projectViewCatalog(config, new FailedClient([]), principalForRole("admin", "admin", { projectIds: ["A"] })),
    (error: Error) => { assert.match(error.message, /PROJECT_CATALOG_UNAVAILABLE/); assert.doesNotMatch(error.message, /private-/); return true; });
});
