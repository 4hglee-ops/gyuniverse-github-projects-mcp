import type { ProjectStateCheckpoint } from "../../workflow/checkpoint.js";

export interface ProjectCheckpointStoreLike {
  readonly persistence: {
    kind: "process_local" | "upstash";
    survivesServerRestart: boolean;
  };
  set(checkpoint: ProjectStateCheckpoint): Promise<ProjectStateCheckpoint>;
  get(owner: string, projectNumber: number): Promise<ProjectStateCheckpoint | undefined>;
}

function key(owner: string, projectNumber: number): string {
  return `${owner.toLowerCase()}#${projectNumber}`;
}

export class MemoryProjectCheckpointStore implements ProjectCheckpointStoreLike {
  readonly persistence = {
    kind: "process_local" as const,
    survivesServerRestart: false,
  };

  private readonly latest = new Map<string, ProjectStateCheckpoint>();

  async set(checkpoint: ProjectStateCheckpoint): Promise<ProjectStateCheckpoint> {
    this.latest.set(key(checkpoint.owner, checkpoint.project.number), checkpoint);
    return checkpoint;
  }

  async get(owner: string, projectNumber: number): Promise<ProjectStateCheckpoint | undefined> {
    return this.latest.get(key(owner, projectNumber));
  }
}

export interface RedisCheckpointClient {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
}

export class RedisProjectCheckpointStore implements ProjectCheckpointStoreLike {
  readonly persistence = {
    kind: "upstash" as const,
    survivesServerRestart: true,
  };

  constructor(
    private readonly redis: RedisCheckpointClient,
    private readonly prefix = "gyuniverse:m10:checkpoint:v1",
  ) {}

  private key(owner: string, projectNumber: number): string {
    return `${this.prefix}:${encodeURIComponent(owner.toLowerCase())}:${projectNumber}`;
  }

  async set(checkpoint: ProjectStateCheckpoint): Promise<ProjectStateCheckpoint> {
    await this.redis.set(
      this.key(checkpoint.owner, checkpoint.project.number),
      checkpoint,
    );
    return checkpoint;
  }

  async get(owner: string, projectNumber: number): Promise<ProjectStateCheckpoint | undefined> {
    const value = await this.redis.get<ProjectStateCheckpoint>(this.key(owner, projectNumber));
    if (!value) return undefined;
    if (value.version !== 1 || value.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error("DURABLE_CHECKPOINT_INVALID: Stored checkpoint payload failed validation.");
    }
    if (value.project.number !== projectNumber) {
      throw new Error("DURABLE_CHECKPOINT_INVALID: Stored checkpoint Project number mismatch.");
    }
    return value;
  }
}
