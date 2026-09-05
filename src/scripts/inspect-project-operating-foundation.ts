import "dotenv/config";

import { assertOwnerAllowed, assertProjectAllowed, loadConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { GitHubRestClient } from "../github/rest-client.js";
import {
  inspectProjectOperatingFoundation,
  planProjectViews,
  TARGET_PROJECT,
} from "../project-foundation/operating-foundation.js";

const config = loadConfig();
assertOwnerAllowed(config, TARGET_PROJECT.owner);
assertProjectAllowed(config, TARGET_PROJECT.id);

const inspection = await inspectProjectOperatingFoundation(
  new GitHubGraphQlClient(config.githubToken),
  new GitHubRestClient(config.githubToken),
);

console.log(JSON.stringify({ inspection, viewPlan: planProjectViews(inspection) }, null, 2));
