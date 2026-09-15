/**
 * Stable identity field types for the frozen Camera Measurements entities.
 *
 * Every id below is a domain-level, non-recycled, immutable-from-creation
 * identifier per docs/architecture/camera-measurements/DOMAIN_MODEL.md and
 * PERSISTENCE_AND_IMMUTABILITY.md. These are plain string aliases (not
 * branded/nominal types) — the minimum representation needed to give each
 * entity a documented, stable identity field without adding runtime
 * casting overhead not required by the frozen architecture.
 *
 * Only entities in scope for GATE-1/G1-04 (REFERENCE_IDENTITY +
 * APPEND_ONLY_FACT) are declared here.
 */

export type BuildingId = string;
export type TargetId = string;
export type ActorId = string;
export type CalibrationSessionId = string;
export type MeasurementId = string;
export type EvidenceId = string;
export type ProposalId = string;
export type DecisionId = string;
export type CitationId = string;

/**
 * Reference to a MeasurementSession (G1-05, MUTABLE_OPERATIONAL_STATE —
 * out of scope for this gate). Modeled as a plain string id so
 * Measurement/Evidence can carry the documented relationship without
 * requiring the MeasurementSession store to exist yet.
 */
export type SessionId = string;

/**
 * Reference to a Geometry's composite (geometryId, version) identity
 * (G1-05, VERSIONED_APPEND_ONLY — out of scope for this gate). Modeled as
 * plain fields so Measurement can carry its documented "0..1 Geometry"
 * relationship without requiring the Geometry store to exist yet.
 */
export type GeometryId = string;
