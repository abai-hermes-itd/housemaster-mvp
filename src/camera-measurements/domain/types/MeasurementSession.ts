/**
 * MeasurementSession — MUTABLE_OPERATIONAL_STATE.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §MeasurementSession, PERSISTENCE_AND_IMMUTABILITY.md §MeasurementSession
 * (G1-05C-03). The open-side accountable-actor field, the
 * calibration-relationship boundary, and the targetId/ScopeItem
 * consistency rule were not specified in that consolidated document
 * set and were resolved separately under HD-MS-01/HD-MS-02/HD-MS-03
 * (Human Frozen).
 */
import type { ActorId, ScopeItemId, SessionId, TargetId } from "../ids/ids.ts";

/** OPEN -> CLOSED only, one-way terminal. No reopen, no cancel/abandon in MVP. Frozen by HD-MS-03's unchanged carryover. */
export type MeasurementSessionStatus = "OPEN" | "CLOSED";

export interface MeasurementSession {
  /** Stable, immutable from creation. */
  readonly sessionId: SessionId;
  /** Immutable from creation. Must equal the parent ScopeItem's own targetId (HD-MS-03). */
  readonly targetId: TargetId;
  /** Immutable from creation. Parent ScopeItem. */
  readonly scopeItemId: ScopeItemId;
  /** Immutable from creation. Required ACTIVE HUMAN_OPERATOR (HD-MS-01). */
  readonly openedBy: ActorId;
  /** OPEN -> CLOSED only, one-way terminal. */
  status: MeasurementSessionStatus;
  /**
   * Closure accountability. Absent while OPEN; required together,
   * written once atomically at the OPEN -> CLOSED transition;
   * immutable afterward.
   */
  closedBy?: ActorId;
  closedAt?: string;
}
