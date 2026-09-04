function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface AppConfig {
  githubToken: string;
  allowedOwners: string[];
  allowedProjectIds: string[];
  writeEnabled: boolean;
}

export function loadConfig(): AppConfig {
  const githubToken = process.env.GITHUB_TOKEN?.trim();
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is required.");
  }

  return {
    githubToken,
    allowedOwners: csv(process.env.GITHUB_PROJECTS_ALLOWED_OWNERS),
    allowedProjectIds: csv(process.env.GITHUB_PROJECTS_ALLOWED_PROJECT_IDS),
    writeEnabled: process.env.GITHUB_PROJECTS_WRITE_ENABLED === "true",
  };
}

export function assertOwnerAllowed(config: AppConfig, owner: string): void {
  if (config.allowedOwners.length > 0 && !config.allowedOwners.includes(owner)) {
    throw new Error(`GitHub Projects owner is not allowed: ${owner}`);
  }
}

export function assertProjectAllowed(config: AppConfig, projectId: string): void {
  if (
    config.allowedProjectIds.length > 0 &&
    !config.allowedProjectIds.includes(projectId)
  ) {
    throw new Error(`GitHub Project is not allowed: ${projectId}`);
  }
}

export function assertWriteEnabled(config: AppConfig): void {
  if (!config.writeEnabled) {
    throw new Error(
      "GitHub Projects write tools are disabled. Set GITHUB_PROJECTS_WRITE_ENABLED=true to enable them.",
    );
  }
}

export function assertProjectWriteAllowed(config: AppConfig, projectId: string): void {
  assertWriteEnabled(config);

  if (config.allowedProjectIds.length === 0) {
    throw new Error(
      "GitHub Projects write tools require GITHUB_PROJECTS_ALLOWED_PROJECT_IDS to contain at least one explicit Project node ID.",
    );
  }

  assertProjectAllowed(config, projectId);
}
