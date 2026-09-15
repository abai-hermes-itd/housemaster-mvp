/**
 * Camera Measurements — Dexie database instance.
 *
 * Built via direct instantiation plus a typed intersection (Dexie's
 * documented v4 pattern), rather than class subclassing, to avoid
 * Dexie 4's known TS2589 "excessively deep" instantiation error that a
 * zero/near-empty-table Dexie subclass can trigger.
 *
 * Only the 12 entities in G1-04 + G1-05B's scope get typed table
 * properties here. Adding a table property for an out-of-scope entity
 * (SurveyAssignment, ScopeItem, MeasurementSession, Report,
 * ReportSnapshot — G1-05C) before its own gate is explicitly out of scope.
 */
import Dexie, { type EntityTable, type Table } from "dexie";
import type { ActorId, BuildingId, CalibrationSessionId, CitationId, DecisionId, DerivedMeasurementId, EvidenceId, FormulaDefinitionId, GeometryId, MeasurementId, ProposalId, TargetId } from "../domain/ids/ids.ts";
import type { ActorRef } from "../domain/types/ActorRef.ts";
import type { Building } from "../domain/types/Building.ts";
import type { CalibrationSession } from "../domain/types/CalibrationSession.ts";
import type { Decision } from "../domain/types/Decision.ts";
import type { DerivedMeasurement } from "../domain/types/DerivedMeasurement.ts";
import type { Evidence } from "../domain/types/Evidence.ts";
import type { FormulaDefinition, FormulaType } from "../domain/types/FormulaDefinition.ts";
import type { Geometry } from "../domain/types/Geometry.ts";
import type { KnowledgeCitation } from "../domain/types/KnowledgeCitation.ts";
import type { Measurement } from "../domain/types/Measurement.ts";
import type { Proposal } from "../domain/types/Proposal.ts";
import type { SpatialTarget } from "../domain/types/SpatialTarget.ts";
import { applySchema } from "./schema.ts";

/** IndexedDB database name for the Camera Measurements feature. */
export const DATABASE_NAME = "housemaster-camera-measurements";

export type CameraMeasurementsDatabase = Dexie & {
  building: EntityTable<Building, "buildingId">;
  spatialTarget: EntityTable<SpatialTarget, "targetId">;
  actorRef: EntityTable<ActorRef, "actorId">;
  calibrationSession: EntityTable<CalibrationSession, "calibrationSessionId">;
  measurement: EntityTable<Measurement, "measurementId">;
  evidence: EntityTable<Evidence, "evidenceId">;
  proposal: EntityTable<Proposal, "proposalId">;
  decision: EntityTable<Decision, "decisionId">;
  knowledgeCitation: EntityTable<KnowledgeCitation, "citationId">;
  // VERSIONED_APPEND_ONLY (G1-05B) — compound-key tables use plain
  // Table<T, K>, not EntityTable (which assumes a single keyof T).
  geometry: Table<Geometry, [GeometryId, number]>;
  formulaDefinition: Table<FormulaDefinition, [FormulaType, number]>;
  derivedMeasurement: EntityTable<DerivedMeasurement, "derivedMeasurementId">;
};

/** Singleton database instance for the application to import. */
export const db = new Dexie(DATABASE_NAME) as CameraMeasurementsDatabase;

applySchema(db);

// Re-exported for repositories/tests that only need the id types alongside `db`.
export type {
  ActorId,
  BuildingId,
  CalibrationSessionId,
  CitationId,
  DecisionId,
  DerivedMeasurementId,
  EvidenceId,
  FormulaDefinitionId,
  GeometryId,
  MeasurementId,
  ProposalId,
  TargetId,
};
