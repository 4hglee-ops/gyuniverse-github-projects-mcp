import {
  analyzeProjectReconciliation,
  type ProjectReconciliationOptions,
} from "../../workflow/reconciliation.js";
import {
  analyzeProjectStateGaps,
  type ProjectStateGapAnalysisOptions,
} from "../../workflow/state-gaps.js";
import { SnapshotService } from "../snapshots/snapshot-service.js";

export class WorkflowService {
  constructor(private readonly snapshots: SnapshotService) {}

  async analyzeStateGaps(
    owner: string,
    number: number,
    first = 100,
    options: ProjectStateGapAnalysisOptions = {},
  ) {
    const snapshot = await this.snapshots.getSnapshot(owner, number, first);
    const analysis = analyzeProjectStateGaps(snapshot, options);
    return {
      ...analysis,
      coverage: this.snapshots.coverage(
        snapshot,
        first,
        "State-gap analysis currently uses the normalized snapshot path, which is bounded by the requested first value (max 100). Use the pagination-aware Project item resolver for exhaustive single-item lookup.",
      ),
    };
  }

  async analyzeReconciliation(
    owner: string,
    number: number,
    first = 100,
    options: ProjectReconciliationOptions = {},
  ) {
    const snapshot = await this.snapshots.getSnapshot(owner, number, first);
    const analysis = analyzeProjectReconciliation(snapshot, options);
    return {
      ...analysis,
      coverage: this.snapshots.coverage(
        snapshot,
        first,
        "Reconciliation currently uses the normalized snapshot path, which is bounded by the requested first value (max 100).",
      ),
    };
  }

  async getBriefContext(owner: string, number: number, first = 100) {
    const snapshot = await this.snapshots.getSnapshot(owner, number, first);
    return {
      snapshot,
      contract: {
        sections: [
          "Project Overview",
          "In Progress",
          "Assigned Work",
          "Unassigned Work",
          "Blocked or At Risk",
          "Review or Merge Candidates",
          "Done",
          "State Gaps",
        ],
        rules: [
          "Project field values are workflow state, not proof that implementation is complete.",
          "Do not infer Done from an intention, assignment, or open pull request.",
          "Surface missing assignees, missing status, and inconsistent item/repository state as State Gaps.",
          "Preserve repository, issue/PR number, URL, assignee, status, priority, and iteration as evidence when present.",
        ],
      },
    };
  }
}
