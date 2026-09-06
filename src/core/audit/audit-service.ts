import {
  auditFailureFromError,
  type RecordWriteAuditInput,
  type WriteAuditEntry,
} from "../../workflow/write-audit.js";
import { createWriteAuditStore } from "./audit-store-factory.js";
import type { WriteAuditStoreLike } from "./audit-store.js";

export interface AuditListOptions {
  limit?: number;
  projectId?: string;
  itemId?: string;
}

export interface AuditListResult {
  persistence: "process-local" | "upstash";
  survivesServerRestart: boolean;
  entries: WriteAuditEntry[];
}

export type AuditFailureBase = Omit<
  RecordWriteAuditInput,
  "outcome" | "verified" | "errorCode"
>;

export class AuditPersistenceError extends Error {
  constructor(cause: unknown) {
    super("AUDIT_PERSISTENCE_FAILED: Write audit could not be persisted.", { cause });
    this.name = "AuditPersistenceError";
  }
}

export function isAuditPersistenceFailure(error: unknown): error is AuditPersistenceError {
  return error instanceof AuditPersistenceError;
}

/**
 * Shared owner of mutation audit records.
 *
 * M10 delegates lifecycle and access to a configured memory or durable Upstash store
 * without changing the MCP and REST business-logic boundary.
 */
export class AuditService {
  private readonly store: WriteAuditStoreLike;

  constructor(maxEntries = 200, store?: WriteAuditStoreLike) {
    this.store = store ?? createWriteAuditStore(maxEntries);
  }

  get persistence(): "process-local" | "upstash" {
    return this.store.persistence.kind === "process_local" ? "process-local" : "upstash";
  }

  async record(input: RecordWriteAuditInput): Promise<WriteAuditEntry> {
    return this.persist(input);
  }

  async recordFailure(input: AuditFailureBase, error: unknown): Promise<WriteAuditEntry> {
    return this.persist(auditFailureFromError(input, error));
  }

  async list(options: AuditListOptions = {}): Promise<AuditListResult> {
    return {
      persistence: this.persistence,
      survivesServerRestart: this.store.persistence.survivesServerRestart,
      entries: await this.store.list(options),
    };
  }

  private async persist(input: RecordWriteAuditInput): Promise<WriteAuditEntry> {
    try {
      return await this.store.append(input);
    } catch (error) {
      throw new AuditPersistenceError(error);
    }
  }
}
