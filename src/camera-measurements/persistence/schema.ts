/**
 * Camera Measurements — Dexie schema.
 *
 * G1-04 adds stores for exactly the 9 entities in this gate's scope:
 *   REFERENCE_IDENTITY:  Building, SpatialTarget, ActorRef
 *   APPEND_ONLY_FACT:    CalibrationSession, Measurement, Evidence,
 *                        Proposal, Decision, KnowledgeCitation
 *
 * Deliberately NOT added (reserved for later, explicitly opened G1
 * moves): SurveyAssignment, ScopeItem, MeasurementSession, Geometry,
 * FormulaDefinition, DerivedMeasurement, Report, ReportSnapshot.
 *
 * Index strings only name lookup keys — they carry no business logic and
 * do not, by themselves, enforce any frozen mutation rule. Mutation
 * rules are enforced by the repository layer in ./repositories.
 */
import type Dexie from "dexie";

/** Current schema version number. Bump only when adding real stores. */
export const SCHEMA_VERSION = 2;

/**
 * Applies the current schema version to a Dexie database instance.
 *
 * No upgrade/migration function is needed for version 1 -> 2: these are
 * nine brand-new stores with no prior rows to transform.
 */
export function applySchema(db: Dexie): void {
  db.version(SCHEMA_VERSION).stores({
    // REFERENCE_IDENTITY
    building: "buildingId",
    spatialTarget: "targetId, buildingId, status",
    actorRef: "actorId, actorType, &externalSubjectRef",

    // APPEND_ONLY_FACT
    calibrationSession: "calibrationSessionId, deviceRef, supersedesCalibrationSessionId",
    measurement:
      "measurementId, sessionId, calibrationSessionId, correctsMeasurementId, acceptingDecisionId",
    evidence: "evidenceId, sessionId, acceptingDecisionId",
    proposal: "proposalId, authorActorId",
    decision: "decisionId, proposalId, actorId",
    knowledgeCitation: "citationId, attachedToType, attachedToId",
  });
}
