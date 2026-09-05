import type {
  NormalizedProjectItemForGaps,
  NormalizedProjectSnapshotForGaps,
} from "./state-gaps.js";

export type ProjectReconciliationKind =
  | "merged_pr_not_done"
  | "done_pr_not_merged";

export interface ProjectReconciliationEvidence {
  itemId: string | null;
  contentId: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  repositoryState: string | null;
  merged: boolean | null;
  projectStatus: string | null;
}

export interface ProjectReconciliationMismatch {
  kind: ProjectReconciliationKind;
  reason: string;
  evidence: ProjectReconciliationEvidence;
}

export interface ProjectReconciliationOptions {
  statusFieldName?: string;
  completedStatusNames?: string[];
  includeArchived?: boolean;
  reportDoneButNotMerged?: boolean;
}

export interface ProjectReconciliationAnalysis {
  analyzedAt: string;
  snapshotAt: string | null;
  projectOwner: string | null;
  configuration: {
    statusFieldName: string;
    completedStatusNames: string[];
    includeArchived: boolean;
    reportDoneButNotMerged: boolean;
  };
  summary: {
    analyzedPullRequests: number;
    mismatchCount: number;
    mergedButNotDoneCount: number;
    doneButNotMergedCount: number;
    alignedCount: number;
    ignoredNonPullRequestItems: number;
  };
  mismatches: ProjectReconciliationMismatch[];
}

function scalarString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function statusOf(
  item: NormalizedProjectItemForGaps,
  statusFieldName: string,
): string | null {
  return scalarString(item.fields?.[statusFieldName]);
}

function isPullRequest(item: NormalizedProjectItemForGaps): boolean {
  const normalized = (item.contentType ?? "")
    .toLowerCase()
    .replace(/[_\s-]/g, "");
  return normalized === "pullrequest";
}

function isCompletedStatus(
  status: string | null,
  completedStatusNames: string[],
): boolean {
  if (!status) return false;
  const completed = new Set(
    completedStatusNames.map((name) => name.trim().toLowerCase()),
  );
  return completed.has(status.toLowerCase());
}

function evidenceFor(
  item: NormalizedProjectItemForGaps,
  projectStatus: string | null,
): ProjectReconciliationEvidence {
  return {
    itemId: item.itemId ?? null,
    contentId: item.contentId ?? null,
    repository: item.repository ?? null,
    number: item.number ?? null,
    title: item.title ?? null,
    url: item.url ?? null,
    repositoryState: item.state ?? null,
    merged: item.merged ?? null,
    projectStatus,
  };
}

export function analyzeProjectReconciliation(
  snapshot: NormalizedProjectSnapshotForGaps,
  options: ProjectReconciliationOptions = {},
): ProjectReconciliationAnalysis {
  const statusFieldName = options.statusFieldName?.trim() || "Status";
  const completedStatusNames = options.completedStatusNames?.length
    ? options.completedStatusNames.map((name) => name.trim()).filter(Boolean)
    : ["Done", "Completed", "Closed"];
  const includeArchived = options.includeArchived ?? false;
  const reportDoneButNotMerged = options.reportDoneButNotMerged ?? true;

  const visibleItems = (snapshot.items ?? []).filter(
    (item) => includeArchived || item.archived !== true,
  );
  const pullRequests = visibleItems.filter(isPullRequest);
  const ignoredNonPullRequestItems = visibleItems.length - pullRequests.length;

  const mismatches: ProjectReconciliationMismatch[] = [];
  let alignedCount = 0;

  for (const item of pullRequests) {
    const projectStatus = statusOf(item, statusFieldName);
    const done = isCompletedStatus(projectStatus, completedStatusNames);
    const merged = item.merged === true;
    const evidence = evidenceFor(item, projectStatus);

    if (merged && !done) {
      mismatches.push({
        kind: "merged_pr_not_done",
        reason: `Pull Request is merged but Project field '${statusFieldName}' is not in a completed status.`,
        evidence,
      });
      continue;
    }

    if (!merged && done && reportDoneButNotMerged) {
      mismatches.push({
        kind: "done_pr_not_merged",
        reason: `Project field '${statusFieldName}' is completed but the Pull Request is not merged.`,
        evidence,
      });
      continue;
    }

    alignedCount += 1;
  }

  return {
    analyzedAt: new Date().toISOString(),
    snapshotAt: snapshot.snapshotAt ?? null,
    projectOwner: snapshot.owner ?? null,
    configuration: {
      statusFieldName,
      completedStatusNames,
      includeArchived,
      reportDoneButNotMerged,
    },
    summary: {
      analyzedPullRequests: pullRequests.length,
      mismatchCount: mismatches.length,
      mergedButNotDoneCount: mismatches.filter(
        (mismatch) => mismatch.kind === "merged_pr_not_done",
      ).length,
      doneButNotMergedCount: mismatches.filter(
        (mismatch) => mismatch.kind === "done_pr_not_merged",
      ).length,
      alignedCount,
      ignoredNonPullRequestItems,
    },
    mismatches,
  };
}
