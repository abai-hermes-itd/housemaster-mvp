/**
 * ScopeItem — MUTABLE_OPERATIONAL_STATE.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §ScopeItem, PERSISTENCE_AND_IMMUTABILITY.md §ScopeItem (G1-05C-02).
 *
 * `fulfillingSessionId` is a plain `SessionId` capture, not a validated
 * reference — the MeasurementSession store/type does not exist yet
 * (G1-05C-03), the identical situation already resolved for
 * `Measurement.sessionId`/`Evidence.sessionId` in G1-04. Tightening this
 * into a real existence check once MeasurementSession exists is a
 * separate, already-identified, forward-only decision — not invented
 * here.
 */
import type { ActorId, AssignmentId, ScopeItemId, SessionId, TargetId } from "../ids/ids.ts";

/**
 * PENDING -> DONE or PENDING -> SKIPPED only, both terminal (no reopen
 * in MVP — DOMAIN_MODEL.md/PERSISTENCE_AND_IMMUTABILITY.md's explicitly
 * stated, intentional non-feature for this gate).
 */
export type ScopeItemStatus = "PENDING" | "DONE" | "SKIPPED";

export interface ScopeItem {
  /** Stable, immutable from creation. */
  readonly scopeItemId: ScopeItemId;
  /** Immutable from creation. */
  readonly assignmentId: AssignmentId;
  /** Immutable from creation. */
  readonly targetId: TargetId;
  /** Shared vocabulary with Measurement.measurementType. Immutable from creation. */
  readonly requiredMeasurementTypes: readonly string[];
  /** PENDING -> DONE or PENDING -> SKIPPED only, both terminal. */
  status: ScopeItemStatus;
  /** Required on DONE; absent otherwise. Plain SessionId capture — see module doc comment. */
  fulfillingSessionId?: SessionId;
  /** Required together on DONE; absent otherwise. Set once, atomically, at the transition. */
  completedBy?: ActorId;
  completedAt?: string;
  /** Required together on SKIPPED; absent otherwise. Set once, atomically, at the transition. */
  skippedBy?: ActorId;
  skippedAt?: string;
  skipReason?: string;
}
