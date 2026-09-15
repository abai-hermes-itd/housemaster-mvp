/**
 * Measurement — APPEND_ONLY_FACT. The single most protected entity in the
 * model — every field is set once at creation; there is no mutable field
 * on Measurement at all.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §Measurement, PERSISTENCE_AND_IMMUTABILITY.md §Measurement.
 */
import type {
  ActorId,
  CalibrationSessionId,
  DecisionId,
  GeometryId,
  MeasurementId,
  SessionId,
} from "../ids/ids.ts";

export type EntryMethod =
  | "MANUAL_ENTERED"
  | "CAMERA_OBSERVED"
  | "SYSTEM_ASSUMED"
  | "IMPORTED_HISTORIC";

export interface Measurement {
  readonly measurementId: MeasurementId;
  /** Parent MeasurementSession. targetId is implicit via this session (not stored here). */
  readonly sessionId: SessionId;
  /** 0..1 — some measurements are scalar-only. Geometry's own store is out of scope for G1-04. */
  readonly geometryId?: GeometryId;
  readonly geometryVersion?: number;
  /** Self-referential correction chain. A correction is always a brand-new row. */
  readonly correctsMeasurementId?: MeasurementId;
  readonly correctionReason?: string;
  readonly correctionActor?: ActorId;
  /** Required iff entryMethod === "CAMERA_OBSERVED". */
  readonly calibrationSessionId?: CalibrationSessionId;
  /** Required. Always the accepting HUMAN_OPERATOR, never an AGENT. */
  readonly actorId: ActorId;
  /**
   * Set once, only if this Measurement resulted from an accepted Proposal —
   * see IDENTITY_AND_ACCOUNTABILITY.md §Accepted-Proposal Attribution.
   */
  readonly acceptingDecisionId?: DecisionId;
  readonly entryMethod: EntryMethod;
  /** Required if entryMethod === "IMPORTED_HISTORIC". */
  readonly sourceRef?: string;
  /** Required if entryMethod === "SYSTEM_ASSUMED". */
  readonly assumptionReason?: string;
  readonly value: number;
  readonly unit: string;
  readonly measurementType: string;
  readonly createdAt: string;
}
