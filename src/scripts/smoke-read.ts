import "dotenv/config";

import { assertOwnerAllowed, assertProjectAllowed, loadConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import {
  getProject,
  getProjectSnapshot,
  listProjectFields,
  listProjectItems,
  listProjects,
} from "../github/projects.js";

function projectIdOf(project: unknown): string {
  if (!project || typeof project !== "object" || !("id" in project)) {
    throw new Error("Project response did not contain a node ID.");
  }

  const id = (project as { id?: unknown }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Project node ID is invalid.");
  }
  return id;
}

const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") {
  cliArguments.shift();
}

const [owner, projectNumberInput] = cliArguments;
if (!owner) {
  throw new Error("Usage: pnpm smoke:read -- <owner> [project-number]");
}

if (projectNumberInput !== undefined && !/^[1-9]\d*$/.test(projectNumberInput)) {
  throw new Error("Project number must be a positive integer.");
}

const projectNumber = projectNumberInput === undefined
  ? undefined
  : Number.parseInt(projectNumberInput, 10);

const config = loadConfig();
assertOwnerAllowed(config, owner);

const client = new GitHubGraphQlClient(config.githubToken);

if (projectNumber === undefined) {
  const projects = await listProjects(client, owner, 100);
  const allowedProjects = config.allowedProjectIds.length === 0
    ? projects
    : projects.filter((project) => {
        try {
          return config.allowedProjectIds.includes(projectIdOf(project));
        } catch {
          return false;
        }
      });

  console.log(JSON.stringify({ owner, projects: allowedProjects }, null, 2));
} else {
  const project = await getProject(client, owner, projectNumber);
  assertProjectAllowed(config, projectIdOf(project));

  const [fields, items, snapshot] = await Promise.all([
    listProjectFields(client, owner, projectNumber),
    listProjectItems(client, owner, projectNumber, 100),
    getProjectSnapshot(client, owner, projectNumber, 100),
  ]);

  console.log(JSON.stringify({ owner, project, fields, items, snapshot }, null, 2));
}
