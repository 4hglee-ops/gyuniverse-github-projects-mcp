import "dotenv/config";

import { assertProjectWriteAllowed, loadConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { updateProjectItemField } from "../github/projects.js";

const cliArguments = process.argv.slice(2);
if (cliArguments[0] === "--") {
  cliArguments.shift();
}

const [projectId, itemId, fieldId, optionId] = cliArguments;
if (!projectId || !itemId || !fieldId || !optionId) {
  throw new Error(
    "Usage: pnpm smoke:update-single-select -- <project-id> <item-id> <field-id> <option-id>",
  );
}

const config = loadConfig();
assertProjectWriteAllowed(config, projectId);

const client = new GitHubGraphQlClient(config.githubToken);
const projectV2Item = await updateProjectItemField(
  client,
  projectId,
  itemId,
  fieldId,
  { singleSelectOptionId: optionId },
);

console.log(JSON.stringify({ projectV2Item }, null, 2));
