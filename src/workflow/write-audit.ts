export type WriteAuditOutcome = "success" | "no_change" | "failed";

export interface RelationshipAuditMetadata {
  sourceContentId: string;
  targetItemId: string;
  targetContentId: string;
  type: "sub_issue" | "blocked_by";
}

export interface WriteAuditEntry {
  id: string;
  at: string;
  operation: string;
  outcome: WriteAuditOutcome;
  actorId: string | null;
  projectId: string | null;
  projectOwner: string | null;
  projectNumber: number | null;
  itemId: string | null;
  fieldName: string | null;
  requestedValue: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  verified: boolean;
  errorCode: string | null;
  capability?: string;
  planId?: string;
  relationship?: RelationshipAuditMetadata;
}

export interface RecordWriteAuditInput extends Omit<WriteAuditEntry, "id" | "at" | "actorId"> {
  at?: string;
  actorId?: string | null;
}

function bounded(value: string | null | undefined, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return value.slice(0, maxLength);
}

export function createWriteAuditEntry(
  input: RecordWriteAuditInput,
  id: string,
): WriteAuditEntry {
  return {
    id: id.slice(0, 128),
    at: input.at ?? new Date().toISOString(),
    operation: input.operation.slice(0, 100),
    outcome: input.outcome,
    actorId: bounded(input.actorId, 256),
    projectId: bounded(input.projectId, 256),
    projectOwner: bounded(input.projectOwner, 256),
    projectNumber: input.projectNumber,
    itemId: bounded(input.itemId, 256),
    fieldName: bounded(input.fieldName, 256),
    requestedValue: bounded(input.requestedValue, 512),
    beforeValue: bounded(input.beforeValue, 512),
    afterValue: bounded(input.afterValue, 512),
    verified: input.verified,
    errorCode: bounded(input.errorCode, 128),
    ...(input.capability ? { capability: input.capability.slice(0, 100) } : {}),
    ...(input.planId ? { planId: input.planId.slice(0, 128) } : {}),
    ...(input.relationship ? { relationship: {
      sourceContentId: input.relationship.sourceContentId.slice(0, 256),
      targetItemId: input.relationship.targetItemId.slice(0, 256),
      targetContentId: input.relationship.targetContentId.slice(0, 256),
      type: input.relationship.type,
    } } : {}),
  };
}

function errorCodeFrom(message: string): string | null {
  const match = /^([A-Z][A-Z0-9_]+):/.exec(message);
  return match?.[1] ?? null;
}

export function auditFailureFromError(
  input: Omit<RecordWriteAuditInput, "outcome" | "verified" | "errorCode">,
  error: unknown,
): RecordWriteAuditInput {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...input,
    outcome: "failed",
    verified: false,
    errorCode: errorCodeFrom(message) ?? "UNEXPECTED_WRITE_ERROR",
  };
}

export class WriteAuditLog {
  private readonly entries: WriteAuditEntry[] = [];
  private sequence = 0;

  constructor(private readonly maxEntries = 200) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new Error("WriteAuditLog maxEntries must be an integer between 1 and 10000.");
    }
  }

  record(input: RecordWriteAuditInput): WriteAuditEntry {
    const entry = createWriteAuditEntry(input, `write-${++this.sequence}`);
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return entry;
  }

  list(options: { limit?: number; projectId?: string; itemId?: string } = {}): WriteAuditEntry[] {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Audit log limit must be an integer between 1 and 200.");
    }

    return this.entries
      .filter((entry) => !options.projectId || entry.projectId === options.projectId)
      .filter((entry) => !options.itemId || entry.itemId === options.itemId)
      .slice(-limit)
      .reverse();
  }
}
