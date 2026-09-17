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
 * Entities in scope for GATE-1/G1-04 (REFERENCE_IDENTITY +
 * APPEND_ONLY_FACT) and GATE-1/G1-05B (VERSIONED_APPEND_ONLY) are
 * declared here.
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
 * Reference to a MeasurementSession (G1-05C, MUTABLE_OPERATIONAL_STATE —
 * out of scope for G1-05B). Modeled as a plain string id so
 * Measurement/Evidence can carry the documented relationship without
 * requiring the MeasurementSession store to exist yet.
 */
export type SessionId = string;

/** Half of Geometry's composite (geometryId, version) identity. */
export type GeometryId = string;

/**
 * FormulaDefinition's own `formulaDefinitionId` field (FORMULA_AND_
 * DERIVATION_CONTRACT.md's "Minimum Fields" list) — distinct from its
 * actual identity/lookup key, the composite (formulaType, version).
 */
export type FormulaDefinitionId = string;

export type DerivedMeasurementId = string;

/**
 * SurveyAssignment's own identity (G1-05C-01, MUTABLE_OPERATIONAL_STATE).
 * The Dexie store for this entity is not yet registered — see MIG-01
 * (all 5 G1-05C stores must land together in one coordinated v4 schema
 * bump) — so this id type exists ahead of that registration, exactly as
 * SessionId already did for MeasurementSession.
 */
export type AssignmentId = string;

/** ScopeItem's own identity (G1-05C-02, MUTABLE_OPERATIONAL_STATE). */
export type ScopeItemId = string;
