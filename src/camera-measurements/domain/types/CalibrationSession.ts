/**
 * CalibrationSession — APPEND_ONLY_FACT.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §CalibrationSession, PERSISTENCE_AND_IMMUTABILITY.md §CalibrationSession,
 * INVARIANTS.md #14/#16.
 */
import type { ActorId, CalibrationSessionId } from "../ids/ids.ts";

export interface CalibrationSession {
  readonly calibrationSessionId: CalibrationSessionId;
  readonly deviceRef: string;
  readonly calibratedAt: string;
  readonly referenceMethod: string;
  /** Required. HUMAN_OPERATOR only — see IDENTITY_AND_ACCOUNTABILITY.md. */
  readonly actorId: ActorId;
  /**
   * Pinned at creation time from whatever validity-window policy was in
   * effect then. Never recalculated later — a subsequent policy change
   * can never reinterpret an existing row's outcome.
   */
  readonly validUntilAt: string;
  /** Set once, on the new row only. The predecessor is never touched. */
  readonly supersedesCalibrationSessionId?: CalibrationSessionId;
}

/**
 * VALID/EXPIRED/SUPERSEDED are fully derived, never stored — see
 * PERSISTENCE_AND_IMMUTABILITY.md §CalibrationSession. `asOf` defaults to
 * "now" but is an explicit parameter so historical replay can ask "was
 * this valid at time T" without ever mutating the row.
 */
export type DerivedCalibrationStatus = "VALID" | "EXPIRED";

export function deriveCalibrationStatus(
  session: Pick<CalibrationSession, "validUntilAt">,
  asOf: Date = new Date(),
): DerivedCalibrationStatus {
  return asOf.getTime() > new Date(session.validUntilAt).getTime() ? "EXPIRED" : "VALID";
}
