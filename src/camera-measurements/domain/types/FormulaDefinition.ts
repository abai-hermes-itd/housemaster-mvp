/**
 * FormulaDefinition — VERSIONED_APPEND_ONLY.
 * Source: docs/architecture/camera-measurements/FORMULA_AND_DERIVATION_CONTRACT.md,
 * DOMAIN_MODEL.md §FormulaDefinition, PERSISTENCE_AND_IMMUTABILITY.md §FormulaDefinition.
 */
import type { FormulaDefinitionId } from "../ids/ids.ts";
import type { TargetType } from "./SpatialTarget.ts";

/** The 8 frozen formulaType values — a closed, curated set. */
export const FROZEN_FORMULA_TYPES = [
  "RECTANGLE_AREA",
  "POLYGON_AREA",
  "VOLUME",
  "POLYLINE_LENGTH",
  "GROSS_MINUS_OPENINGS",
  "AGGREGATE_SUM",
  "DEFECT_AREA_TOTAL",
  "DEFECT_LENGTH_TOTAL",
] as const;

export type FormulaType = (typeof FROZEN_FORMULA_TYPES)[number];

/** Three canonical physical quantities — COUNT and ANGLE are explicitly not part of the frozen MVP set. */
export type OutputQuantityType = "LENGTH" | "AREA" | "VOLUME";

/** Groups formulas by what they semantically represent, independent of exact formulaType — for AGGREGATE_SUM compatibility. */
export type SemanticCategory =
  | "RAW_AREA"
  | "NET_AREA"
  | "DEFECT_AREA_METRIC"
  | "DEFECT_LENGTH_METRIC"
  | "VOLUME_METRIC";

/** Only the two base formulas (POLYGON_AREA, POLYLINE_LENGTH) ever consume raw Geometry directly. */
export type RequiredGeometryType = "NONE" | "POINT" | "POLYLINE" | "POLYGON";

export interface FormulaDefinition {
  readonly formulaDefinitionId: FormulaDefinitionId;
  /** Half of the composite identity. Immutable — permanently frozen meaning at first use. */
  readonly formulaType: FormulaType;
  /** The other half of the composite identity. */
  readonly version: number;
  readonly implementationRef: string;
  /** Detects silent code drift under a stable version tag. */
  readonly implementationHash: string;
  readonly inputContract: string;
  readonly outputQuantityType: OutputQuantityType;
  readonly semanticCategory: SemanticCategory;
  readonly allowedTargetTypes: readonly TargetType[];
  readonly requiredGeometryType: RequiredGeometryType;
  /**
   * Set once, only on the successor, at its own creation. A version
   * number within the SAME formulaType — never a cross-type reference,
   * since a genuine redefinition requires a new formulaType, not a new
   * version of an old one. Successor chain is linear (at most one
   * successor per version) and acyclic, validated at write time.
   */
  readonly supersedesFormulaVersion?: number;
}

/** ACTIVE/DEPRECATED are fully derived, never stored — see formulaDefinitionRepository.getLifecycleStatus(). */
export type FormulaLifecycleStatus = "ACTIVE" | "DEPRECATED";
