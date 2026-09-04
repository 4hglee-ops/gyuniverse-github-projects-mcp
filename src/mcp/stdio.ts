import "dotenv/config";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { buildMcpServer } from "./build-server.js";

const config = loadConfig();
const client = new GitHubGraphQlClient(config.githubToken);

console.error("gyuniverse-github-projects-mcp starting in stdio mode...");
console.error(`write tools: ${config.writeEnabled ? "ENABLED" : "disabled"}`);
console.error(
  `owner allowlist: ${config.allowedOwners.length > 0 ? config.allowedOwners.join(", ") : "all"}`,
);
console.error("MCP connection waiting...");

serveStdio(() => buildMcpServer({ config, client }));
