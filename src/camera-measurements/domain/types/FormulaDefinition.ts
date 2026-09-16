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

/**
 * SF-02B — canonical `FormulaDefinition` field values, derived directly
 * from FORMULA_AND_DERIVATION_CONTRACT.md's Applicability table and
 * Semantic Categories section. Single source of truth shared by
 * `formulaDefinitionRepository.create()`'s write-time enforcement and by
 * test fixtures, so the two can never drift apart.
 *
 * Scope is intentionally narrower than "all 4 fields for all 8
 * formulaTypes" — SF-02A found two genuine ambiguities that frozen text
 * does not resolve, and this deliberately does NOT invent a rule for
 * either:
 *   - `AGGREGATE_SUM`'s own `(outputQuantityType, semanticCategory)` is
 *     not fixed at the FormulaDefinition level — the formula is designed
 *     to be reusable across different compatible categories, so no
 *     single canonical pair exists to enforce. See
 *     `CANONICAL_QUANTITY_CATEGORY` (AGGREGATE_SUM deliberately absent).
 *   - `POLYLINE_LENGTH`'s `semanticCategory` is never assigned a value
 *     anywhere in the frozen Semantic Categories table (which is itself
 *     scoped "(for AGGREGATE_SUM compatibility)" only). Its
 *     `outputQuantityType` (`LENGTH`) IS determinable and is enforced via
 *     `CANONICAL_OUTPUT_QUANTITY_TYPE_ONLY`.
 * `allowedTargetTypes` and `requiredGeometryType` ARE fully determinable
 * for all 8 formulaTypes and are enforced without exception.
 */
export const CANONICAL_ALLOWED_TARGET_TYPES: Record<FormulaType, readonly TargetType[]> = {
  RECTANGLE_AREA: ["ROOM", "BASEMENT_TECH", "FACADE", "ROOF", "ATTIC", "STAIR_AREA", "OPENING", "DEFECT_AREA"],
  POLYGON_AREA: ["ROOM", "BASEMENT_TECH", "FACADE", "ROOF", "ATTIC", "STAIR_AREA", "OPENING", "DEFECT_AREA"],
  VOLUME: ["ROOM", "BASEMENT_TECH", "ATTIC"],
  POLYLINE_LENGTH: ["DEFECT_LINEAR"],
  GROSS_MINUS_OPENINGS: ["FACADE", "ROOF"],
  AGGREGATE_SUM: ["ROOM", "BASEMENT_TECH", "FACADE", "ROOF", "ATTIC", "STAIR_AREA"],
  DEFECT_AREA_TOTAL: ["DEFECT_AREA"],
  DEFECT_LENGTH_TOTAL: ["DEFECT_LINEAR"],
};

export const CANONICAL_REQUIRED_GEOMETRY_TYPE: Record<FormulaType, RequiredGeometryType> = {
  RECTANGLE_AREA: "NONE",
  POLYGON_AREA: "POLYGON",
  VOLUME: "NONE",
  POLYLINE_LENGTH: "POLYLINE",
  GROSS_MINUS_OPENINGS: "NONE",
  AGGREGATE_SUM: "NONE",
  DEFECT_AREA_TOTAL: "NONE",
  DEFECT_LENGTH_TOTAL: "NONE",
};

/** Fixed (outputQuantityType, semanticCategory) pair — only the 6 formulaTypes SF-02A found fully determinable. AGGREGATE_SUM is deliberately absent. */
export const CANONICAL_QUANTITY_CATEGORY: Partial<Record<FormulaType, { outputQuantityType: OutputQuantityType; semanticCategory: SemanticCategory }>> = {
  RECTANGLE_AREA: { outputQuantityType: "AREA", semanticCategory: "RAW_AREA" },
  POLYGON_AREA: { outputQuantityType: "AREA", semanticCategory: "RAW_AREA" },
  VOLUME: { outputQuantityType: "VOLUME", semanticCategory: "VOLUME_METRIC" },
  GROSS_MINUS_OPENINGS: { outputQuantityType: "AREA", semanticCategory: "NET_AREA" },
  DEFECT_AREA_TOTAL: { outputQuantityType: "AREA", semanticCategory: "DEFECT_AREA_METRIC" },
  DEFECT_LENGTH_TOTAL: { outputQuantityType: "LENGTH", semanticCategory: "DEFECT_LENGTH_METRIC" },
};

/** POLYLINE_LENGTH only: outputQuantityType is determinable even though semanticCategory (SF-02A DEFERRED_POLYLINE_LENGTH_FIELDS) is not. */
export const CANONICAL_OUTPUT_QUANTITY_TYPE_ONLY: Partial<Record<FormulaType, OutputQuantityType>> = {
  POLYLINE_LENGTH: "LENGTH",
};
