export type WriteAuditOutcome = "success" | "no_change" | "failed";

export interface WriteAuditEntry {
  id: string;
  at: string;
  operation: string;
  outcome: WriteAuditOutcome;
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
}

export interface RecordWriteAuditInput extends Omit<WriteAuditEntry, "id" | "at"> {
  at?: string;
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
    const entry: WriteAuditEntry = {
      ...input,
      id: `write-${++this.sequence}`,
      at: input.at ?? new Date().toISOString(),
    };
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
