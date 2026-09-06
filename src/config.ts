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
  bulkApprovalMode?: BulkApprovalMode;
}

export type BulkApprovalMode = "same_admin_allowed" | "distinct_admin_required";

export function bulkApprovalModeFromEnvironment(): BulkApprovalMode {
  const value = process.env.M10_BULK_APPROVAL_MODE?.trim() || "same_admin_allowed";
  if (value !== "same_admin_allowed" && value !== "distinct_admin_required") {
    throw new Error(
      "M10_BULK_APPROVAL_MODE must be 'same_admin_allowed' or 'distinct_admin_required'.",
    );
  }
  return value;
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
    bulkApprovalMode: bulkApprovalModeFromEnvironment(),
  };
}

export function assertOwnerAllowed(config: AppConfig, owner: string): void {
  if (config.allowedOwners.length > 0 && !config.allowedOwners.includes(owner)) {
    throw new Error(`GitHub Projects owner is not allowed: ${owner.slice(0, 256)}`);
  }
}

export function assertProjectAllowed(config: AppConfig, projectId: string): void {
  if (
    config.allowedProjectIds.length > 0 &&
    !config.allowedProjectIds.includes(projectId)
  ) {
    throw new Error(`GitHub Project is not allowed: ${projectId.slice(0, 256)}`);
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
