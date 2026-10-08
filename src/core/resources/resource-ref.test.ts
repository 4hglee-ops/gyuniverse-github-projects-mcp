import assert from "node:assert/strict";
import test from "node:test";
import {
  githubProjectRef, jiraProjectRef, resourceIdentityKey,
  githubWorkItemRef, jiraWorkItemRef, workItemIdentityKey,
  normalizeResourceRef, normalizeWorkItemRef,
} from "./resource-ref.js";

test("GitHub legacy owner and project number form a canonical provider-qualified reference", () => {
  const ref = githubProjectRef("Gyuniverse-HQ", 2);
  assert.deepEqual(ref, { provider: "github_projects", kind: "github_project_v2", owner: "gyuniverse-hq", projectNumber: 2 });
  assert.equal(resourceIdentityKey(ref), "github_projects:gyuniverse-hq:2");
  assert.equal(resourceIdentityKey(githubProjectRef("gyuniverse-hq", 2)), resourceIdentityKey(ref));
});

test("Jira project identity uses stable cloud ID and project ID, not mutable key", () => {
  const original = jiraProjectRef("CLOUD-123", "10042", "SKN");
  assert.equal(original.projectKey, "SKN");
  assert.equal(resourceIdentityKey(original), "jira:cloud-123:10042");
  assert.equal(resourceIdentityKey(jiraProjectRef("cloud-123", "10042", "NEW")), resourceIdentityKey(original));
  assert.notEqual(resourceIdentityKey(original), resourceIdentityKey(jiraProjectRef("other-site", "10042", "SKN")));
});

test("GitHub and Jira never alias one another even if identifiers resemble each other", () => {
  assert.notEqual(resourceIdentityKey(githubProjectRef("cloud-123", 10042)), resourceIdentityKey(jiraProjectRef("cloud-123", "10042")));
});

test("invalid and mismatched provider resources fail closed", () => {
  assert.throws(() => githubProjectRef("bad owner", 2), /RESOURCE_REF_INVALID/);
  assert.throws(() => githubProjectRef("gyuniverse-hq", 0), /RESOURCE_REF_INVALID/);
  assert.throws(() => githubProjectRef("gyuniverse-hq", Number.MAX_SAFE_INTEGER + 1), /RESOURCE_REF_INVALID/);
  assert.throws(() => jiraProjectRef("", "10042"), /RESOURCE_REF_INVALID/);
  assert.throws(() => jiraProjectRef("cloud-123", "SKN"), /RESOURCE_REF_INVALID/);
  assert.throws(() => normalizeResourceRef({provider:"github_projects",kind:"jira_project",owner:"gyuniverse-hq",projectNumber:2} as never), /RESOURCE_REF_INVALID/);
  assert.throws(() => normalizeResourceRef({provider:"unsupported",kind:"github_project_v2"} as never), /RESOURCE_REF_INVALID/);
});

test("work-item references preserve provider and resource identity", () => {
  const gitItem = githubWorkItemRef(githubProjectRef("gyuniverse-hq",2),"PVTI_123");
  const jiraItem = jiraWorkItemRef(jiraProjectRef("cloud-123","10042","SKN"),"20001","SKN-12");
  assert.equal(workItemIdentityKey(gitItem),"github_projects:gyuniverse-hq:2:PVTI_123");
  assert.equal(workItemIdentityKey(jiraItem),"jira:cloud-123:10042:20001");
  assert.deepEqual(normalizeWorkItemRef(gitItem),gitItem);
  assert.deepEqual(normalizeWorkItemRef(jiraItem),jiraItem);
  assert.throws(() => normalizeWorkItemRef({...gitItem,provider:"jira"} as never),/PROVIDER_RESOURCE_MISMATCH/);
  assert.throws(() => jiraWorkItemRef(jiraItem.resource,"abc"),/RESOURCE_REF_INVALID/);
});
