export interface NormalizedProjectItemForGaps {
  itemId?: string | null;
  itemType?: string | null;
  archived?: boolean | null;
  contentType?: string | null;
  contentId?: string | null;
  repository?: string | null;
  number?: number | null;
  title?: string | null;
  url?: string | null;
  state?: string | null;
  merged?: boolean | null;
  assignees?: Array<string | null | undefined> | null;
  fields?: Record<string, unknown> | null;
}

export interface NormalizedProjectSnapshotForGaps {
  snapshotAt?: string;
  owner?: string;
  itemCount?: number;
  items?: NormalizedProjectItemForGaps[];
}

export interface StateGapEvidence {
  itemId: string | null;
  itemType: string | null;
  contentType: string | null;
  contentId: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  repositoryState: string | null;
  merged: boolean | null;
  status: string | null;
  assignees: string[];
}

export type ProjectStateGapKind =
  | "missing_status"
  | "missing_assignee";

export interface ProjectStateGap {
  kind: ProjectStateGapKind;
  reason: string;
  evidence: StateGapEvidence;
}

export interface ProjectStateGapAnalysisOptions {
  statusFieldName?: string;
  assigneeFieldNames?: string[];
  completedStatusNames?: string[];
  includeArchived?: boolean;
  includeCompletedForAssignee?: boolean;
}

export interface ProjectStateGapAnalysis {
  analyzedAt: string;
  snapshotAt: string | null;
  projectOwner: string | null;
  configuration: {
    statusFieldName: string;
    assigneeFieldNames: string[];
    completedStatusNames: string[];
    includeArchived: boolean;
    includeCompletedForAssignee: boolean;
  };
  summary: {
    analyzedItems: number;
    gapCount: number;
    itemsWithAnyGap: number;
    missingStatusCount: number;
    missingAssigneeCount: number;
  };
  gaps: ProjectStateGap[];
}

function stringsFrom(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function scalarString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function effectiveAssignees(
  item: NormalizedProjectItemForGaps,
  assigneeFieldNames: string[],
): string[] {
  const direct = stringsFrom(item.assignees ?? []);
  const fields = item.fields ?? {};
  const fromProjectFields = assigneeFieldNames.flatMap((fieldName) =>
    stringsFrom(fields[fieldName]),
  );

  return dedupe([...direct, ...fromProjectFields]);
}

function statusOf(
  item: NormalizedProjectItemForGaps,
  statusFieldName: string,
): string | null {
  return scalarString(item.fields?.[statusFieldName]);
}

function isCompleted(
  item: NormalizedProjectItemForGaps,
  status: string | null,
  completedStatusNames: string[],
): boolean {
  const normalizedCompletedStatuses = new Set(
    completedStatusNames.map((name) => name.trim().toLowerCase()),
  );

  if (status && normalizedCompletedStatuses.has(status.toLowerCase())) {
    return true;
  }

  if (item.merged === true) return true;
  return item.state?.toUpperCase() === "CLOSED";
}

function evidenceFor(
  item: NormalizedProjectItemForGaps,
  status: string | null,
  assignees: string[],
): StateGapEvidence {
  return {
    itemId: item.itemId ?? null,
    itemType: item.itemType ?? null,
    contentType: item.contentType ?? null,
    contentId: item.contentId ?? null,
    repository: item.repository ?? null,
    number: item.number ?? null,
    title: item.title ?? null,
    url: item.url ?? null,
    repositoryState: item.state ?? null,
    merged: item.merged ?? null,
    status,
    assignees,
  };
}

export function analyzeProjectStateGaps(
  snapshot: NormalizedProjectSnapshotForGaps,
  options: ProjectStateGapAnalysisOptions = {},
): ProjectStateGapAnalysis {
  const statusFieldName = options.statusFieldName?.trim() || "Status";
  const assigneeFieldNames = options.assigneeFieldNames?.length
    ? options.assigneeFieldNames.map((name) => name.trim()).filter(Boolean)
    : ["Assignees", "Assignee"];
  const completedStatusNames = options.completedStatusNames?.length
    ? options.completedStatusNames.map((name) => name.trim()).filter(Boolean)
    : ["Done", "Completed", "Closed"];
  const includeArchived = options.includeArchived ?? false;
  const includeCompletedForAssignee = options.includeCompletedForAssignee ?? false;

  const items = (snapshot.items ?? []).filter(
    (item) => includeArchived || item.archived !== true,
  );

  const gaps: ProjectStateGap[] = [];

  for (const item of items) {
    const status = statusOf(item, statusFieldName);
    const assignees = effectiveAssignees(item, assigneeFieldNames);
    const evidence = evidenceFor(item, status, assignees);

    if (!status) {
      gaps.push({
        kind: "missing_status",
        reason: `Project field '${statusFieldName}' is empty or missing.`,
        evidence,
      });
    }

    const completed = isCompleted(item, status, completedStatusNames);
    if (
      assignees.length === 0 &&
      (includeCompletedForAssignee || !completed)
    ) {
      gaps.push({
        kind: "missing_assignee",
        reason: "No repository assignee or configured Project assignee field value was found.",
        evidence,
      });
    }
  }

  const itemIdsWithGap = new Set(
    gaps.map((gap) => gap.evidence.itemId ?? gap.evidence.contentId ?? gap.evidence.url ?? gap.evidence.title),
  );

  return {
    analyzedAt: new Date().toISOString(),
    snapshotAt: snapshot.snapshotAt ?? null,
    projectOwner: snapshot.owner ?? null,
    configuration: {
      statusFieldName,
      assigneeFieldNames,
      completedStatusNames,
      includeArchived,
      includeCompletedForAssignee,
    },
    summary: {
      analyzedItems: items.length,
      gapCount: gaps.length,
      itemsWithAnyGap: itemIdsWithGap.size,
      missingStatusCount: gaps.filter((gap) => gap.kind === "missing_status").length,
      missingAssigneeCount: gaps.filter((gap) => gap.kind === "missing_assignee").length,
    },
    gaps,
  };
}
