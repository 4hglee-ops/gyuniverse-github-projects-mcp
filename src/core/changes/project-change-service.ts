import { SnapshotService } from "../snapshots/snapshot-service.js";
import {
  compareProjectStateCheckpoint,
  createProjectStateCheckpoint,
  type ProjectSnapshotLike,
  type ProjectStateComparison,
  type ProjectStateDelta,
} from "../../workflow/checkpoint.js";
import { createProjectCheckpointStore } from "./checkpoint-store-factory.js";
import type { ProjectCheckpointStoreLike } from "./checkpoint-store.js";

export interface ChangeReadOptions {
  first?: number;
  initializeIfMissing?: boolean;
}

export interface ProjectChangesResult {
  baselineInitialized: boolean;
  comparison: ProjectStateComparison | null;
  changes: {
    entered: ProjectStateDelta[];
    left: ProjectStateDelta[];
    status: ProjectStateDelta[];
    priority: ProjectStateDelta[];
    assignees: ProjectStateDelta[];
    repositoryState: ProjectStateDelta[];
    merged: ProjectStateDelta[];
    archived: ProjectStateDelta[];
    fields: ProjectStateDelta[];
    metadata: ProjectStateDelta[];
  };
  baseline: {
    createdAt: string;
    sourceSnapshotAt: string | null;
    itemCount: number;
    coverage: unknown;
  };
  current: {
    sourceSnapshotAt: string | null;
    itemCount: number;
    coverage: unknown;
  } | null;
  checkpointReplaced: false;
  persistence: {
    kind: "process_local" | "upstash";
    survivesServerRestart: boolean;
  };
}

function grouped(comparison: ProjectStateComparison | null): ProjectChangesResult["changes"] {
  const deltas = comparison?.deltas ?? [];
  const by = (kind: ProjectStateDelta["kind"]) => deltas.filter((delta) => delta.kind === kind);
  return {
    entered: by("item_entered_snapshot"),
    left: by("item_left_snapshot"),
    status: by("status_changed"),
    priority: by("priority_changed"),
    assignees: by("assignees_changed"),
    repositoryState: by("repository_state_changed"),
    merged: by("merged_changed"),
    archived: by("archived_changed"),
    fields: by("field_changed"),
    metadata: by("item_metadata_changed"),
  };
}

/** Shared checkpoint/change boundary used by MCP and REST adapters. */
export class ProjectChangeService {
  constructor(
    private readonly snapshots: SnapshotService,
    private readonly checkpoints: ProjectCheckpointStoreLike = createProjectCheckpointStore(),
  ) {}

  async captureBaseline(owner: string, number: number, first = 100) {
    const snapshot = await this.snapshots.getSnapshot(owner, number, first);
    const checkpoint = createProjectStateCheckpoint(snapshot as ProjectSnapshotLike, {
      owner,
      projectNumber: number,
      requestedItems: first,
    });
    await this.checkpoints.set(checkpoint);
    return {
      checkpoint,
      persistence: {
        ...this.checkpoints.persistence,
        note: this.checkpoints.persistence.survivesServerRestart
          ? "The latest checkpoint is stored durably in the configured M10 governance store."
          : "The latest checkpoint is kept only in this server process.",
      },
    };
  }

  async getChanges(owner: string, number: number, options: ChangeReadOptions = {}): Promise<ProjectChangesResult> {
    const first = options.first ?? 100;
    let baseline = await this.checkpoints.get(owner, number);

    if (!baseline) {
      if (!options.initializeIfMissing) {
        throw new Error(
          `No checkpoint exists for ${owner} Project #${number}. Create one first or call get_project_changes with initializeIfMissing=true.`,
        );
      }
      const initialized = await this.captureBaseline(owner, number, first);
      baseline = initialized.checkpoint;
      return {
        baselineInitialized: true,
        comparison: null,
        changes: grouped(null),
        baseline: {
          createdAt: baseline.createdAt,
          sourceSnapshotAt: baseline.sourceSnapshotAt,
          itemCount: baseline.itemCount,
          coverage: baseline.coverage,
        },
        current: null,
        checkpointReplaced: false,
        persistence: this.checkpoints.persistence,
      };
    }

    const snapshot = await this.snapshots.getSnapshot(owner, number, first);
    const current = createProjectStateCheckpoint(snapshot as ProjectSnapshotLike, {
      owner,
      projectNumber: number,
      requestedItems: first,
    });
    const comparison = compareProjectStateCheckpoint(baseline, current);

    return {
      baselineInitialized: false,
      comparison,
      changes: grouped(comparison),
      baseline: {
        createdAt: baseline.createdAt,
        sourceSnapshotAt: baseline.sourceSnapshotAt,
        itemCount: baseline.itemCount,
        coverage: baseline.coverage,
      },
      current: {
        sourceSnapshotAt: current.sourceSnapshotAt,
        itemCount: current.itemCount,
        coverage: current.coverage,
      },
      checkpointReplaced: false,
      persistence: this.checkpoints.persistence,
    };
  }
}
