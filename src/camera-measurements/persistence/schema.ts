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
 * Version 4 — MIG-01B — adds stores for all 5 G1-05C entities together,
 * in this one coordinated bump, per MIG-01's frozen contract ("all 5
 * G1-05C stores must land in one atomic v4 schema bump" — never split
 * across v4/v5/v6...): SurveyAssignment, ScopeItem, MeasurementSession,
 * Report, ReportSnapshot (MUTABLE_OPERATIONAL_STATE / IMMUTABLE_SNAPSHOT).
 * The 12 version-3 stores are repeated unchanged. Only `surveyAssignment`
 * has a matching typed table property in db.ts today (its domain type
 * exists, per HD-01/HD-01A) — the other 4 stores are real, physically
 * registered object stores from this version onward, but remain
 * untyped in `CameraMeasurementsDatabase` until their own domain types
 * are authored in their own gates (G1-05C-02..05). This is deliberate:
 * the physical schema and the TypeScript convenience layer are
 * independent concerns (see MIG-01B), and Dexie does not require a
 * store to have a typed property for the store to exist or be queried
 * via `db.table("...")`.
 *
 * Index strings only name lookup keys — they carry no business logic and
 * do not, by themselves, enforce any frozen mutation rule. Mutation
 * rules are enforced by the repository layer in ./repositories. The 5
 * new v4 stores are registered primary-key-only: no repository exists
 * yet for any of them, so no secondary-index query need is demonstrated
 * — per MIG-01B's instruction to prefer primary-key-only registration
 * over guessing at unneeded indexes.
 */
import type Dexie from "dexie";

/** Current schema version number. Bump only when adding real stores. */
export const SCHEMA_VERSION = 4;

/**
 * The complete store set as of version 2 — exported for the same reason
 * as VERSION_3_STORES below: schemaMigration.test.ts needs to construct
 * a genuine, isolated "as of v2" database without duplicating these
 * index strings by hand.
 */
export const VERSION_2_STORES = {
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
 * The complete store set as of version 3 — exported so migration tests
 * (schemaMigration.test.ts) can construct a genuine, isolated "as of
 * v3" database to verify the real v3 -> v4 upgrade path, without
 * duplicating these index strings by hand.
 */
export const VERSION_3_STORES = {
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
} as const;

/**
 * Applies every schema version, in order, to a Dexie database instance.
 *
 * No upgrade/migration function is needed for any version bump so far:
 * version 1 -> 2, 2 -> 3, and 3 -> 4 each only ever ADD brand-new
 * stores, with no prior rows in any of them to transform.
 */
export function applySchema(db: Dexie): void {
  // Version 2 — unchanged from G1-04. Left registered so a real database
  // that was ever opened at version 2 has a valid upgrade path forward.
  db.version(2).stores(VERSION_2_STORES);

  // Version 3 — unchanged from G1-05B. Repeats the 9 version-2 stores,
  // adds exactly 3 new ones. Left registered for the same reason as v2.
  db.version(3).stores(VERSION_3_STORES);

  // Version 4 — MIG-01B. Repeats the 12 version-3 stores unchanged, adds
  // exactly 5 new ones, all in this one bump.
  db.version(SCHEMA_VERSION).stores({
    ...VERSION_3_STORES,

    // MUTABLE_OPERATIONAL_STATE / IMMUTABLE_SNAPSHOT (G1-05C) — primary
    // key only; see the module doc comment above for why.
    surveyAssignment: "assignmentId",
    scopeItem: "scopeItemId",
    measurementSession: "sessionId",
    report: "reportId",
    reportSnapshot: "snapshotId",
  });
}
