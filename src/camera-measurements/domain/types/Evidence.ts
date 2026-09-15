/**
 * Evidence — APPEND_ONLY_FACT. Immutable from creation, no exception; no
 * correction/supersession chain in MVP.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md §Evidence,
 * PERSISTENCE_AND_IMMUTABILITY.md §Evidence, INVARIANTS.md #17.
 */
import type { ActorId, DecisionId, EvidenceId, SessionId } from "../ids/ids.ts";

/** Restricted to physical-capture provenance — never a Knowledge/RAG object. */
export type EvidenceSourceType = "PHOTO" | "VIDEO" | "NOTE" | "CALIBRATION_ARTIFACT";

export interface Evidence {
  readonly evidenceId: EvidenceId;
  /** The MeasurementSession this evidence supports — DOMAIN_MODEL.md §Evidence purpose. */
  readonly sessionId: SessionId;
  /** Pointer into object storage — never an inline blob. No storage backend is implemented here. */
  readonly storageRef: string;
  readonly sourceType: EvidenceSourceType;
  /**
   * Content-integrity value (e.g. a hash) accompanying storageRef so a
   * silent payload swap behind the same evidenceId is detectable —
   * INVARIANTS.md #17.
   */
  readonly integrityValue: string;
  /** Required. HUMAN_OPERATOR only — never AGENT. */
  readonly actorId: ActorId;
  /** Set once, only if this Evidence resulted from an accepted Proposal. */
  readonly acceptingDecisionId?: DecisionId;
  readonly createdAt: string;
}
