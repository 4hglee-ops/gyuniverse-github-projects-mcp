import { randomUUID } from "node:crypto";

import {
  WriteAuditLog,
  createWriteAuditEntry,
  type RecordWriteAuditInput,
  type WriteAuditEntry,
} from "../../workflow/write-audit.js";

export interface AuditStoreListOptions {
  limit?: number;
  projectId?: string;
  itemId?: string;
}

export interface WriteAuditStoreLike {
  readonly persistence: {
    kind: "process_local" | "upstash";
    survivesServerRestart: boolean;
  };
  append(input: RecordWriteAuditInput): Promise<WriteAuditEntry>;
  list(options?: AuditStoreListOptions): Promise<WriteAuditEntry[]>;
}

export class MemoryWriteAuditStore implements WriteAuditStoreLike {
  readonly persistence = {
    kind: "process_local" as const,
    survivesServerRestart: false,
  };

  private readonly log: WriteAuditLog;

  constructor(maxEntries = 200) {
    this.log = new WriteAuditLog(maxEntries);
  }

  async append(input: RecordWriteAuditInput): Promise<WriteAuditEntry> {
    return this.log.record(input);
  }

  async list(options: AuditStoreListOptions = {}): Promise<WriteAuditEntry[]> {
    return this.log.list(options);
  }
}

export interface RedisAuditClient {
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
}

const APPEND_AND_TRIM = `
redis.call("LPUSH", KEYS[1], ARGV[1])
redis.call("LTRIM", KEYS[1], 0, tonumber(ARGV[2]) - 1)
return 1
`;

function parseStoredEntry(value: unknown): WriteAuditEntry {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("DURABLE_AUDIT_INVALID: Stored audit payload is not valid JSON.");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DURABLE_AUDIT_INVALID: Stored audit payload failed validation.");
  }

  const candidate = parsed as Record<string, unknown>;
  const nullableString = (name: string, maxLength = 512): boolean =>
    candidate[name] === null ||
    (typeof candidate[name] === "string" && (candidate[name] as string).length <= maxLength);
  const exactKeys = [
    "actorId", "afterValue", "at", "beforeValue", "errorCode", "fieldName", "id",
    "itemId", "operation", "outcome", "projectId", "projectNumber", "projectOwner",
    "requestedValue", "verified",
  ];
  if ("planId" in candidate) {
    exactKeys.push("planId");
    if (typeof candidate.planId !== "string" || candidate.planId.length < 1 || candidate.planId.length > 128) {
      throw new Error("DURABLE_AUDIT_INVALID: Invalid bulk plan correlation ID.");
    }
  }
  if ("relationship" in candidate) {
    exactKeys.push("relationship");
    const relation = candidate.relationship;
    if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
      throw new Error("DURABLE_AUDIT_INVALID: Invalid relationship metadata.");
    }
    const metadata = relation as Record<string, unknown>;
    if (Object.keys(metadata).sort().join(",") !== "sourceContentId,targetContentId,targetItemId,type" ||
        !["sub_issue", "blocked_by"].includes(String(metadata.type)) ||
        !["sourceContentId", "targetContentId", "targetItemId"].every((key) =>
          typeof metadata[key] === "string" && metadata[key].length > 0 && metadata[key].length <= 256)) {
      throw new Error("DURABLE_AUDIT_INVALID: Invalid relationship metadata.");
    }
  }

  if (
    Object.keys(candidate).sort().join("\0") !== exactKeys.sort().join("\0") ||
    typeof candidate.id !== "string" || candidate.id.length > 128 ||
    typeof candidate.at !== "string" || !Number.isFinite(Date.parse(candidate.at)) ||
    typeof candidate.operation !== "string" || candidate.operation.length > 100 ||
    !["success", "no_change", "failed"].includes(String(candidate.outcome)) ||
    !nullableString("actorId", 256) ||
    !nullableString("projectId", 256) ||
    !nullableString("projectOwner", 256) ||
    !(candidate.projectNumber === null || (Number.isInteger(candidate.projectNumber) && Number(candidate.projectNumber) >= 1)) ||
    !nullableString("itemId", 256) ||
    !nullableString("fieldName", 256) ||
    !nullableString("requestedValue") ||
    !nullableString("beforeValue") ||
    !nullableString("afterValue") ||
    typeof candidate.verified !== "boolean" ||
    !nullableString("errorCode", 128)
  ) {
    throw new Error("DURABLE_AUDIT_INVALID: Stored audit payload failed validation.");
  }

  return candidate as unknown as WriteAuditEntry;
}

export class RedisWriteAuditStore implements WriteAuditStoreLike {
  readonly persistence = {
    kind: "upstash" as const,
    survivesServerRestart: true,
  };

  constructor(
    private readonly redis: RedisAuditClient,
    private readonly maxEntries = 200,
    private readonly key = "gyuniverse:m10:audit:v1:entries",
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10_000) {
      throw new Error("RedisWriteAuditStore maxEntries must be an integer between 1 and 10000.");
    }
  }

  async append(input: RecordWriteAuditInput): Promise<WriteAuditEntry> {
    const entry = createWriteAuditEntry(input, `write-${randomUUID()}`);
    await this.redis.eval(APPEND_AND_TRIM, [this.key], [JSON.stringify(entry), this.maxEntries]);
    return entry;
  }

  async list(options: AuditStoreListOptions = {}): Promise<WriteAuditEntry[]> {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Audit log limit must be an integer between 1 and 200.");
    }

    const values = await this.redis.lrange(this.key, 0, this.maxEntries - 1);
    return values
      .map(parseStoredEntry)
      .filter((entry) => !options.projectId || entry.projectId === options.projectId)
      .filter((entry) => !options.itemId || entry.itemId === options.itemId)
      .slice(0, limit);
  }
}
