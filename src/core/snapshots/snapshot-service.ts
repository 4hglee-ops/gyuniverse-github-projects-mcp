import type { NormalizedProjectSnapshotForGaps } from "../../workflow/state-gaps.js";

export interface ProjectSnapshot extends NormalizedProjectSnapshotForGaps {
  project?: unknown;
  fields?: unknown[];
  itemCount?: number;
}

export interface ProjectSnapshotReader {
  getProjectSnapshot(owner: string, number: number, first?: number): Promise<unknown>;
}

export interface SnapshotCoverage {
  requestedItems: number;
  returnedItems: number;
  completeBeyondFirstPage: false;
  note: string;
}

/** Shared normalized-snapshot boundary for MCP and future REST adapters. */
export class SnapshotService {
  constructor(private readonly projects: ProjectSnapshotReader) {}

  async getSnapshot(owner: string, number: number, first = 100): Promise<ProjectSnapshot> {
    return await this.projects.getProjectSnapshot(owner, number, first) as ProjectSnapshot;
  }

  coverage(snapshot: ProjectSnapshot, requestedItems: number, note: string): SnapshotCoverage {
    return {
      requestedItems,
      returnedItems: snapshot.itemCount ?? snapshot.items?.length ?? 0,
      completeBeyondFirstPage: false,
      note,
    };
  }
}
