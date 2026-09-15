/**
 * Camera Measurements — Dexie schema.
 *
 * Versions are additive and never rewritten in place — each
 * `db.version(N).stores({...})` call is Dexie's own upgrade mechanism
 * and must list the FULL store set that should exist at that version
 * (Dexie diffs consecutive version() calls to compute the upgrade path);
 * it is not a delta on its own. Historical version() calls are left
 * exactly as they were written.
 *
 * Version 2 — G1-04 — added stores for the 9 entities in that gate's
 * scope:
 *   REFERENCE_IDENTITY:  Building, SpatialTarget, ActorRef
 *   APPEND_ONLY_FACT:    CalibrationSession, Measurement, Evidence,
 *                        Proposal, Decision, KnowledgeCitation
 *
 * Version 3 — G1-05B — adds stores for exactly the 3 VERSIONED_APPEND_ONLY
 * entities in that gate's scope: Geometry, FormulaDefinition,
 * DerivedMeasurement. The 9 version-2 stores are repeated unchanged.
 *
 * Deliberately NOT added (reserved for later, explicitly opened G1
 * moves): SurveyAssignment, ScopeItem, MeasurementSession, Report,
 * ReportSnapshot (MUTABLE_OPERATIONAL_STATE / IMMUTABLE_SNAPSHOT — G1-05C).
 *
 * Index strings only name lookup keys — they carry no business logic and
 * do not, by themselves, enforce any frozen mutation rule. Mutation
 * rules are enforced by the repository layer in ./repositories.
 */
import type Dexie from "dexie";

/** Current schema version number. Bump only when adding real stores. */
export const SCHEMA_VERSION = 3;

const VERSION_2_STORES = {
  // REFERENCE_IDENTITY
  building: "buildingId",
  spatialTarget: "targetId, buildingId, status",
  actorRef: "actorId, actorType, &externalSubjectRef",

  // APPEND_ONLY_FACT
  calibrationSession: "calibrationSessionId, deviceRef, supersedesCalibrationSessionId",
  measurement: "measurementId, sessionId, calibrationSessionId, correctsMeasurementId, acceptingDecisionId",
  evidence: "evidenceId, sessionId, acceptingDecisionId",
  proposal: "proposalId, authorActorId",
  decision: "decisionId, proposalId, actorId",
  knowledgeCitation: "citationId, attachedToType, attachedToId",
} as const;

/**
 * Applies every schema version, in order, to a Dexie database instance.
 *
 * No upgrade/migration function is needed for either version bump so
 * far: version 1 -> 2 and version 2 -> 3 both only ever ADD brand-new
 * stores, with no prior rows in any of them to transform.
 */
export function applySchema(db: Dexie): void {
  // Version 2 — unchanged from G1-04. Left registered so a real database
  // that was ever opened at version 2 has a valid upgrade path forward.
  db.version(2).stores(VERSION_2_STORES);

  // Version 3 — G1-05B. Repeats the 9 version-2 stores unchanged, adds
  // exactly 3 new ones.
  db.version(SCHEMA_VERSION).stores({
    ...VERSION_2_STORES,

    // VERSIONED_APPEND_ONLY
    // Compound primary key [geometryId+version] — Dexie enforces this
    // pair unique natively; `geometryId` alone is indexed separately for
    // "all versions of this geometry" / "current version" queries.
    geometry: "[geometryId+version], geometryId",
    // Compound primary key [formulaType+version]; `formulaType` alone is
    // indexed for chain/lifecycle-status queries.
    formulaDefinition: "[formulaType+version], formulaType",
    // Single-field primary key (DOMAIN_MODEL.md: "Primary identifier:
    // derivedMeasurementId"); secondary indexes support predecessor-chain
    // lookups and semanticResultKey-scoped "current" resolution.
    derivedMeasurement:
      "derivedMeasurementId, formulaType, supersedesDerivedMeasurementId, " +
      "[targetId+outputQuantityType+semanticCategory+calculationScope]",
  });
}
