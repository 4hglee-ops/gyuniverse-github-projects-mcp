import {
  WriteAuditLog,
  auditFailureFromError,
  type RecordWriteAuditInput,
  type WriteAuditEntry,
} from "../../workflow/write-audit.js";

export interface AuditListOptions {
  limit?: number;
  projectId?: string;
  itemId?: string;
}

export interface AuditListResult {
  persistence: "process-local";
  entries: WriteAuditEntry[];
}

export type AuditFailureBase = Omit<
  RecordWriteAuditInput,
  "outcome" | "verified" | "errorCode"
>;

/**
 * Shared owner of mutation audit records.
 *
 * M5 keeps the existing process-local storage semantics while moving lifecycle and
 * access ownership out of the MCP adapter. M10 can replace the backing store with a
 * durable implementation without changing MCP or future REST adapter contracts.
 */
export class AuditService {
  private readonly log: WriteAuditLog;

  constructor(maxEntries = 200) {
    this.log = new WriteAuditLog(maxEntries);
  }

  record(input: RecordWriteAuditInput): WriteAuditEntry {
    return this.log.record(input);
  }

  recordFailure(input: AuditFailureBase, error: unknown): WriteAuditEntry {
    return this.log.record(auditFailureFromError(input, error));
  }

  list(options: AuditListOptions = {}): AuditListResult {
    return {
      persistence: "process-local",
      entries: this.log.list(options),
    };
  }
}
