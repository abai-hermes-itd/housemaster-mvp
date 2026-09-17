/**
 * SurveyAssignment — MUTABLE_OPERATIONAL_STATE.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §SurveyAssignment, PERSISTENCE_AND_IMMUTABILITY.md §SurveyAssignment.
 * The `status` enum and closure-accountability fields (`closedBy`/
 * `closedAt`) were not specified in that consolidated document set and
 * were resolved separately under HD-01/HD-01A (Human Frozen).
 */
import type { ActorId, AssignmentId, BuildingId } from "../ids/ids.ts";

/** OPEN -> CLOSED only, one-way terminal. Reopen not supported in MVP. Frozen by HD-01. */
export type SurveyAssignmentStatus = "OPEN" | "CLOSED";

/**
 * One immutable entry per reassignment, appended atomically with the
 * `assignedOperator` change. Never edited or removed once written.
 */
export interface ReassignmentHistoryEntry {
  readonly fromOperator: ActorId;
  readonly toOperator: ActorId;
  readonly changedBy: ActorId;
  readonly changedAt: string;
}

export interface SurveyAssignment {
  /** Stable, immutable from creation. */
  readonly assignmentId: AssignmentId;
  /** Immutable from creation. */
  readonly buildingId: BuildingId;
  /**
   * Current-assignee pointer. Must always equal the latest
   * reassignmentHistory entry's toOperator (or the original assignee if
   * no reassignment has occurred yet) — PERSISTENCE_AND_IMMUTABILITY.md's
   * consistency rule.
   */
  assignedOperator: ActorId;
  /** OPEN -> CLOSED only, one-way terminal (HD-01). */
  status: SurveyAssignmentStatus;
  /** Append-only. Never edited or removed once written. */
  reassignmentHistory: readonly ReassignmentHistoryEntry[];
  /**
   * Closure accountability (HD-01A, Human Frozen). Absent while OPEN;
   * required together, written once atomically at the OPEN -> CLOSED
   * transition; immutable afterward.
   */
  closedBy?: ActorId;
  closedAt?: string;
}
