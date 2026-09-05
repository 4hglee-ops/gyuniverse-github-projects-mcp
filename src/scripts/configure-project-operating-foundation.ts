import "dotenv/config";

import { loadConfig } from "../config.js";
import { GitHubGraphQlClient } from "../github/graphql-client.js";
import { GitHubRestClient } from "../github/rest-client.js";
import {
  applyProjectOperatingFoundation,
  inspectProjectOperatingFoundation,
  planProjectViews,
} from "../project-foundation/operating-foundation.js";

const apply = process.argv.slice(2).includes("--apply");
const config = loadConfig();
const graphQl = new GitHubGraphQlClient(config.githubToken);
const rest = new GitHubRestClient(config.githubToken);

if (!apply) {
  const inspection = await inspectProjectOperatingFoundation(graphQl, rest);
  console.log(JSON.stringify({
    mode: "dry-run",
    message: "No GitHub mutation was attempted. Pass --apply only after reviewing this plan.",
    inspection,
    viewPlan: planProjectViews(inspection),
    iterationPlan: inspection.iteration.exists
      ? "preserve-existing-without-using-it"
      : "leave-absent-no-sprint-default",
  }, null, 2));
} else {
  const result = await applyProjectOperatingFoundation(graphQl, rest, config);
  console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
}
