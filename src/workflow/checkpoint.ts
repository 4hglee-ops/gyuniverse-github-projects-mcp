export interface ProjectSnapshotItemLike {
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

export interface ProjectSnapshotLike {
  snapshotAt?: string | null;
  owner?: string | null;
  project?: unknown;
  itemCount?: number | null;
  items?: ProjectSnapshotItemLike[] | null;
}

export interface ProjectCheckpointItem {
  itemId: string;
  itemType: string | null;
  archived: boolean;
  contentType: string | null;
  contentId: string | null;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  merged: boolean | null;
  assignees: string[];
  fields: Record<string, unknown>;
}

export interface ProjectStateCheckpoint {
  version: 1;
  createdAt: string;
  sourceSnapshotAt: string | null;
  owner: string;
  project: {
    id: string | null;
    number: number;
    title: string | null;
    url: string | null;
  };
  itemCount: number;
  coverage: {
    requestedItems: number;
    returnedItems: number;
    complete: boolean;
    note: string;
  };
  items: ProjectCheckpointItem[];
}

export type ProjectStateDeltaKind =
  | "item_entered_snapshot"
  | "item_left_snapshot"
  | "status_changed"
  | "priority_changed"
  | "assignees_changed"
  | "repository_state_changed"
  | "merged_changed"
  | "archived_changed"
  | "field_changed"
  | "item_metadata_changed";

export interface ProjectStateDelta {
  kind: ProjectStateDeltaKind;
  itemId: string;
  repository: string | null;
  number: number | null;
  title: string | null;
  url: string | null;
  fieldName?: string;
  before: unknown;
  after: unknown;
}

export interface ProjectStateComparison {
  checkpointCreatedAt: string;
  currentSnapshotAt: string | null;
  owner: string;
  projectNumber: number;
  hasChanges: boolean;
  summary: {
    deltaCount: number;
    itemsChanged: number;
    enteredSnapshotCount: number;
    leftSnapshotCount: number;
    statusChangedCount: number;
    priorityChangedCount: number;
    assigneesChangedCount: number;
    repositoryStateChangedCount: number;
    mergedChangedCount: number;
    archivedChangedCount: number;
    fieldChangedCount: number;
    metadataChangedCount: number;
  };
  coverage: {
    checkpointComplete: boolean;
    currentComplete: boolean;
    membershipChangesAuthoritative: boolean;
    note: string;
  };
  deltas: ProjectStateDelta[];
}

interface CreateCheckpointOptions {
  owner: string;
  projectNumber: number;
  requestedItems: number;
  createdAt?: string;
}

function projectMetadata(project: unknown): { id: string | null; title: string | null; url: string | null } {
  if (!project || typeof project !== "object") return { id: null, title: null, url: null };
  const value = project as { id?: unknown; title?: unknown; url?: unknown };
  return {
    id: typeof value.id === "string" ? value.id : null,
    title: typeof value.title === "string" ? value.title : null,
    url: typeof value.url === "string" ? value.url : null,
  };
}

function normalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeUnknown);
    return normalized.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))
      ? normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : normalized;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeUnknown(item)]),
    );
  }
  return value ?? null;
}

function normalizeFields(fields: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeUnknown(value)]),
  );
}

function normalizeItem(item: ProjectSnapshotItemLike): ProjectCheckpointItem {
  if (typeof item.itemId !== "string" || !item.itemId) {
    throw new Error("Project snapshot item is missing a stable itemId.");
  }
  return {
    itemId: item.itemId,
    itemType: typeof item.itemType === "string" ? item.itemType : null,
    archived: item.archived === true,
    contentType: typeof item.contentType === "string" ? item.contentType : null,
    contentId: typeof item.contentId === "string" ? item.contentId : null,
    repository: typeof item.repository === "string" ? item.repository : null,
    number: typeof item.number === "number" ? item.number : null,
    title: typeof item.title === "string" ? item.title : null,
    url: typeof item.url === "string" ? item.url : null,
    state: typeof item.state === "string" ? item.state : null,
    merged: typeof item.merged === "boolean" ? item.merged : null,
    assignees: (item.assignees ?? []).filter((login): login is string => typeof login === "string" && login.length > 0).sort(),
    fields: normalizeFields(item.fields),
  };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeUnknown(left)) === JSON.stringify(normalizeUnknown(right));
}

function identityOf(item: ProjectCheckpointItem) {
  return {
    itemId: item.itemId,
    repository: item.repository,
    number: item.number,
    title: item.title,
    url: item.url,
  };
}

export function createProjectStateCheckpoint(
  snapshot: ProjectSnapshotLike,
  options: CreateCheckpointOptions,
): ProjectStateCheckpoint {
  const metadata = projectMetadata(snapshot.project);
  const items = (snapshot.items ?? []).map(normalizeItem).sort((left, right) => left.itemId.localeCompare(right.itemId));
  const returnedItems = items.length;
  const complete = returnedItems < options.requestedItems;

  return {
    version: 1,
    createdAt: options.createdAt ?? new Date().toISOString(),
    sourceSnapshotAt: typeof snapshot.snapshotAt === "string" ? snapshot.snapshotAt : null,
    owner: options.owner,
    project: {
      id: metadata.id,
      number: options.projectNumber,
      title: metadata.title,
      url: metadata.url,
    },
    itemCount: returnedItems,
    coverage: {
      requestedItems: options.requestedItems,
      returnedItems,
      complete,
      note: complete
        ? "The snapshot returned fewer items than requested, so this checkpoint covers the full Project item connection at capture time."
        : "The snapshot reached the requested item limit. Membership deltas may be incomplete until Project snapshot pagination is implemented.",
    },
    items,
  };
}

function pushDelta(
  deltas: ProjectStateDelta[],
  kind: ProjectStateDeltaKind,
  item: ProjectCheckpointItem,
  before: unknown,
  after: unknown,
  fieldName?: string,
) {
  deltas.push({
    kind,
    ...identityOf(item),
    ...(fieldName ? { fieldName } : {}),
    before,
    after,
  });
}

export function compareProjectStateCheckpoint(
  checkpoint: ProjectStateCheckpoint,
  current: ProjectStateCheckpoint,
): ProjectStateComparison {
  if (checkpoint.owner !== current.owner || checkpoint.project.number !== current.project.number) {
    throw new Error("Checkpoint and current snapshot refer to different GitHub Projects.");
  }
  if (checkpoint.project.id && current.project.id && checkpoint.project.id !== current.project.id) {
    throw new Error("Checkpoint and current snapshot have different Project node IDs.");
  }

  const previousItems = new Map(checkpoint.items.map((item) => [item.itemId, item]));
  const currentItems = new Map(current.items.map((item) => [item.itemId, item]));
  const deltas: ProjectStateDelta[] = [];

  for (const [itemId, item] of currentItems) {
    const previous = previousItems.get(itemId);
    if (!previous) {
      pushDelta(deltas, "item_entered_snapshot", item, null, item);
      continue;
    }

    if (previous.archived !== item.archived) pushDelta(deltas, "archived_changed", item, previous.archived, item.archived);
    if (previous.state !== item.state) pushDelta(deltas, "repository_state_changed", item, previous.state, item.state);
    if (previous.merged !== item.merged) pushDelta(deltas, "merged_changed", item, previous.merged, item.merged);
    if (!equal(previous.assignees, item.assignees)) pushDelta(deltas, "assignees_changed", item, previous.assignees, item.assignees);

    const metadataFields = ["itemType", "contentType", "contentId", "repository", "number", "title", "url"] as const;
    for (const fieldName of metadataFields) {
      if (!equal(previous[fieldName], item[fieldName])) {
        pushDelta(deltas, "item_metadata_changed", item, previous[fieldName], item[fieldName], fieldName);
      }
    }

    const fieldNames = new Set([...Object.keys(previous.fields), ...Object.keys(item.fields)]);
    for (const fieldName of [...fieldNames].sort()) {
      const before = previous.fields[fieldName] ?? null;
      const after = item.fields[fieldName] ?? null;
      if (equal(before, after)) continue;
      const normalizedName = fieldName.trim().toLowerCase();
      const kind: ProjectStateDeltaKind = normalizedName === "status"
        ? "status_changed"
        : normalizedName === "priority"
          ? "priority_changed"
          : "field_changed";
      pushDelta(deltas, kind, item, before, after, fieldName);
    }
  }

  for (const [itemId, item] of previousItems) {
    if (!currentItems.has(itemId)) pushDelta(deltas, "item_left_snapshot", item, item, null);
  }

  deltas.sort((left, right) => left.itemId.localeCompare(right.itemId) || left.kind.localeCompare(right.kind) || (left.fieldName ?? "").localeCompare(right.fieldName ?? ""));
  const count = (kind: ProjectStateDeltaKind) => deltas.filter((delta) => delta.kind === kind).length;
  const changedItems = new Set(deltas.map((delta) => delta.itemId));
  const membershipChangesAuthoritative = checkpoint.coverage.complete && current.coverage.complete;

  return {
    checkpointCreatedAt: checkpoint.createdAt,
    currentSnapshotAt: current.sourceSnapshotAt,
    owner: current.owner,
    projectNumber: current.project.number,
    hasChanges: deltas.length > 0,
    summary: {
      deltaCount: deltas.length,
      itemsChanged: changedItems.size,
      enteredSnapshotCount: count("item_entered_snapshot"),
      leftSnapshotCount: count("item_left_snapshot"),
      statusChangedCount: count("status_changed"),
      priorityChangedCount: count("priority_changed"),
      assigneesChangedCount: count("assignees_changed"),
      repositoryStateChangedCount: count("repository_state_changed"),
      mergedChangedCount: count("merged_changed"),
      archivedChangedCount: count("archived_changed"),
      fieldChangedCount: count("field_changed"),
      metadataChangedCount: count("item_metadata_changed"),
    },
    coverage: {
      checkpointComplete: checkpoint.coverage.complete,
      currentComplete: current.coverage.complete,
      membershipChangesAuthoritative,
      note: membershipChangesAuthoritative
        ? "Both snapshots covered the full returned Project item connection, so entered/left membership deltas are authoritative for these captures."
        : "At least one snapshot reached its requested item limit. Attribute changes for matching item IDs are valid, but entered/left membership deltas are snapshot-window observations rather than authoritative add/remove events.",
    },
    deltas,
  };
}

export class ProjectCheckpointStore {
  private readonly latest = new Map<string, ProjectStateCheckpoint>();

  private key(owner: string, projectNumber: number): string {
    return `${owner.toLowerCase()}#${projectNumber}`;
  }

  set(checkpoint: ProjectStateCheckpoint): ProjectStateCheckpoint {
    this.latest.set(this.key(checkpoint.owner, checkpoint.project.number), checkpoint);
    return checkpoint;
  }

  get(owner: string, projectNumber: number): ProjectStateCheckpoint | undefined {
    return this.latest.get(this.key(owner, projectNumber));
  }
}
