import { SnapshotService, type ProjectSnapshot } from "../snapshots/snapshot-service.js";
import type { NormalizedProjectItemForGaps } from "../../workflow/state-gaps.js";

export interface HighLevelReadOptions {
  first?: number;
  includeArchived?: boolean;
}

export interface MyWorkOptions extends HighLevelReadOptions {
  login: string;
  includeDone?: boolean;
}

export interface ProjectReadItem {
  itemId: string | null;
  contentId: string | null;
  contentType: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  merged: boolean | null;
  status: string | null;
  priority: string | null;
  assignees: string[];
  fields: Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function readItem(item: NormalizedProjectItemForGaps): ProjectReadItem {
  const fields = item.fields ?? {};
  return {
    itemId: item.itemId ?? null,
    contentId: item.contentId ?? null,
    contentType: item.contentType ?? null,
    repository: item.repository ?? null,
    number: item.number ?? null,
    title: item.title ?? null,
    url: item.url ?? null,
    state: item.state ?? null,
    merged: item.merged ?? null,
    status: text(fields.Status),
    priority: text(fields.Priority),
    assignees: dedupe([
      ...strings(item.assignees ?? []),
      ...strings(fields.Assignees),
      ...strings(fields.Assignee),
    ]),
    fields,
  };
}

function isDone(item: ProjectReadItem): boolean {
  const status = item.status?.toLowerCase();
  return status === "done" || status === "completed" || status === "closed";
}

function visibleItems(snapshot: ProjectSnapshot, includeArchived = false): ProjectReadItem[] {
  return (snapshot.items ?? [])
    .filter((item) => includeArchived || item.archived !== true)
    .map(readItem);
}

function projectMeta(snapshot: ProjectSnapshot): Record<string, unknown> {
  if (!snapshot.project || typeof snapshot.project !== "object") return {};
  return snapshot.project as Record<string, unknown>;
}

function explicitBlockerReason(item: ProjectReadItem): string | null {
  if (item.status?.toLowerCase() === "blocked") return "Status is explicitly Blocked.";

  const blocked = item.fields.Blocked;
  if (blocked === true || (typeof blocked === "string" && ["true", "yes", "blocked"].includes(blocked.trim().toLowerCase()))) {
    return "Project field 'Blocked' is explicitly set.";
  }

  for (const fieldName of ["Blocker", "Blocked Reason", "Blocker Reason"]) {
    const value = text(item.fields[fieldName]);
    if (value) return `${fieldName}: ${value}`;
  }

  return null;
}

export class HighLevelReadService {
  constructor(private readonly snapshots: SnapshotService) {}

  private async items(owner: string, number: number, options: HighLevelReadOptions = {}) {
    const first = options.first ?? 100;
    const snapshot = await this.snapshots.getSnapshot(owner, number, first);
    return {
      snapshot,
      items: visibleItems(snapshot, options.includeArchived ?? false),
      coverage: this.snapshots.coverage(
        snapshot,
        first,
        "High-level reads use the normalized Project snapshot path and are bounded by the requested first value (max 100).",
      ),
    };
  }

  async getProjectBrief(owner: string, number: number, options: HighLevelReadOptions = {}) {
    const { snapshot, items, coverage } = await this.items(owner, number, options);
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const item of items) {
      const status = item.status ?? "Unspecified";
      const priority = item.priority ?? "Unspecified";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      byPriority[priority] = (byPriority[priority] ?? 0) + 1;
    }

    const blockers = items
      .map((item) => ({ item, reason: explicitBlockerReason(item) }))
      .filter((entry): entry is { item: ProjectReadItem; reason: string } => Boolean(entry.reason));

    return {
      project: projectMeta(snapshot),
      snapshotAt: snapshot.snapshotAt ?? null,
      summary: {
        visibleItems: items.length,
        openItems: items.filter((item) => !isDone(item)).length,
        doneItems: items.filter(isDone).length,
        unassignedOpenItems: items.filter((item) => !isDone(item) && item.assignees.length === 0).length,
        reviewQueueItems: items.filter((item) => item.status === "In Review").length,
        explicitBlockers: blockers.length,
        byStatus,
        byPriority,
      },
      focus: {
        inProgress: items.filter((item) => item.status === "In Progress"),
        reviewQueue: items.filter((item) => item.status === "In Review"),
        unassigned: items.filter((item) => !isDone(item) && item.assignees.length === 0),
        blockers,
      },
      evidenceRule: "Only Project/repository fields present in the snapshot are treated as evidence. Planned or assigned work is not inferred as completed work.",
      coverage,
    };
  }

  async getMyWork(owner: string, number: number, options: MyWorkOptions) {
    const login = options.login.trim();
    if (!login) throw new Error("login is required for get_my_work until M7 identity is available.");
    const { items, coverage } = await this.items(owner, number, options);
    const matches = items.filter((item) =>
      item.assignees.some((assignee) => assignee.toLowerCase() === login.toLowerCase()) &&
      (options.includeDone === true || !isDone(item)),
    );
    return { login, count: matches.length, items: matches, coverage };
  }

  async getBacklog(owner: string, number: number, options: HighLevelReadOptions = {}) {
    const { items, coverage } = await this.items(owner, number, options);
    const matches = items.filter((item) => item.status === "Backlog");
    return { count: matches.length, items: matches, coverage };
  }

  async getReviewQueue(owner: string, number: number, options: HighLevelReadOptions = {}) {
    const { items, coverage } = await this.items(owner, number, options);
    const matches = items.filter((item) => item.status === "In Review");
    return { count: matches.length, items: matches, coverage };
  }

  async getUnassignedWork(owner: string, number: number, options: HighLevelReadOptions = {}) {
    const { items, coverage } = await this.items(owner, number, options);
    const matches = items.filter((item) => !isDone(item) && item.assignees.length === 0);
    return { count: matches.length, items: matches, coverage };
  }

  async getBlockers(owner: string, number: number, options: HighLevelReadOptions = {}) {
    const { items, coverage } = await this.items(owner, number, options);
    const blockers = items
      .map((item) => ({ item, reason: explicitBlockerReason(item) }))
      .filter((entry): entry is { item: ProjectReadItem; reason: string } => Boolean(entry.reason));
    return {
      count: blockers.length,
      blockers,
      inferencePolicy: "Blockers are reported only when an explicit Blocked status/field/reason exists. Missing assignment or ordinary workflow state is not inferred as a blocker.",
      coverage,
    };
  }
}
