/**
 * DerivedMeasurement — VERSIONED_APPEND_ONLY.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §DerivedMeasurement, PERSISTENCE_AND_IMMUTABILITY.md §DerivedMeasurement,
 * FORMULA_AND_DERIVATION_CONTRACT.md §DerivedMeasurement — Rules.
 */
import type { ActorId, DerivedMeasurementId, GeometryId, MeasurementId, TargetId } from "../ids/ids.ts";
import type { FormulaType, OutputQuantityType, SemanticCategory } from "./FormulaDefinition.ts";

/** Pins the exact composite Geometry identity used as an input — never re-resolved at replay time. */
export interface GeometryInputRef {
  readonly geometryId: GeometryId;
  readonly version: number;
}

export interface DerivedMeasurement {
  readonly derivedMeasurementId: DerivedMeasurementId;
  /** Pinned exact (formulaType, version) used — never "latest." */
  readonly formulaType: FormulaType;
  readonly formulaVersion: number;
  /** Pinned exact input IDs — Measurement rows consumed by the formula. */
  readonly inputMeasurementIds: readonly MeasurementId[];
  /** Pinned exact input IDs — Geometry (geometryId, version) composites consumed by the formula. */
  readonly inputGeometryRefs: readonly GeometryInputRef[];
  /** Pinned exact input IDs — other DerivedMeasurement rows consumed (e.g. AGGREGATE_SUM sources). */
  readonly inputDerivedMeasurementIds: readonly DerivedMeasurementId[];
  /**
   * Set once at creation, self-referential, linear + acyclic. Permitted
   * only within an identical semanticResultKey (the four fields below).
   */
  readonly supersedesDerivedMeasurementId?: DerivedMeasurementId;

  // --- semanticResultKey (4-part), flattened for indexing —
  // FORMULA_AND_DERIVATION_CONTRACT.md §DerivedMeasurement — Rules ---
  readonly targetId: TargetId;
  readonly outputQuantityType: OutputQuantityType;
  readonly semanticCategory: SemanticCategory;
  /**
   * FORMULA_AND_DERIVATION_CONTRACT.md §"calculationScope — narrowest
   * stable representation": for single-target formulas, a fixed,
   * degenerate value equal to `targetId` itself — stored and compared
   * as-is. For aggregate formulas (see `AGGREGATE_FORMULA_TYPES` below),
   * the frozen text requires this field to itself capture BOTH "the
   * declared scope identifier" AND "the exact canonical set of source
   * input IDs actually included at computation time" — not merely a
   * label backed by data held in sibling fields (G1-05B-R finding #1).
   *
   * `derivedMeasurementRepository.create()` is the single authoritative
   * place this canonicalization happens: for an aggregate formulaType,
   * whatever scope label the caller passes here is combined with the
   * record's own pinned `inputMeasurementIds` / `inputGeometryRefs` /
   * `inputDerivedMeasurementIds` via `canonicalizeAggregateCalculationScope()`
   * below, and THAT combined value — not the caller's raw label — is
   * what actually gets persisted and later compared for
   * `semanticResultKey` equality. For non-aggregate formulas, the
   * caller's value is stored unchanged (existing behavior, preserved).
   */
  readonly calculationScope: string;

  /** Written atomically with the result at creation — never edited afterward. Required only for list-input formulas combining 2+ spatially-relevant inputs. */
  readonly overlapReviewedBy?: ActorId;
  readonly overlapReviewedAt?: string;
  readonly overlapRiskNoted?: boolean;

  readonly createdAt: string;
}

/**
 * No stored actor — DerivedMeasurement creation is a deterministic
 * computation (NOT_APPLICABLE actor, per IDENTITY_AND_ACCOUNTABILITY.md);
 * it carries no independent trust/status field of its own.
 */

/**
 * The 3 aggregate formulaTypes whose `calculationScope` must canonically
 * embed the exact resolved input set — FORMULA_AND_DERIVATION_CONTRACT.md
 * §"calculationScope". Kept as a plain literal-string array (not imported
 * from FormulaDefinition.ts) so this fix touches no other allowed-scope
 * file; `FormulaType` is still used to keep it checked against the real
 * enum.
 */
export const AGGREGATE_FORMULA_TYPES: readonly FormulaType[] = [
  "AGGREGATE_SUM",
  "DEFECT_AREA_TOTAL",
  "DEFECT_LENGTH_TOTAL",
];

/** The exact pinned input set a `calculationScope` canonicalization is built from. */
export interface CanonicalScopeInputs {
  readonly inputMeasurementIds: readonly MeasurementId[];
  readonly inputGeometryRefs: readonly GeometryInputRef[];
  readonly inputDerivedMeasurementIds: readonly DerivedMeasurementId[];
}

/**
 * Builds the canonical `calculationScope` value for an aggregate formula:
 * `<declaredScopeIdentifier>|M:<sorted measurement ids>|G:<sorted "geometryId@vVersion">|D:<sorted derived ids>`.
 *
 * - Deterministic and stable across replay: no timestamp, no randomness,
 *   no external dependency.
 * - Order-independent for semantically identical input sets: each
 *   category is independently sorted before joining, so supplying the
 *   same ids in a different array order canonicalizes identically.
 * - Duplicate-sensitive: `Array.prototype.sort()` does not remove
 *   duplicates, so a repeated id still appears the same number of times
 *   in the canonical form — no deduplication is invented here, matching
 *   "duplicate-sensitive behavior must follow the existing frozen input
 *   semantics."
 * - Geometry refs are canonicalized by their FULL composite identity
 *   (`geometryId` + `version`), so two refs sharing a `geometryId` but
 *   differing only by `version` canonicalize differently.
 * - Not a hash: a plain, human-readable, deterministic string, per the
 *   preferred shape — and even if it were a hash, the exact ids remain
 *   independently recoverable from `inputMeasurementIds` /
 *   `inputGeometryRefs` / `inputDerivedMeasurementIds`, which this
 *   function never removes or replaces.
 * - Assumes no id value contains this format's delimiter characters
 *   (`|`, `,`, `@v`) — true for every id in this system, which are
 *   opaque strings produced by this codebase's own id generation, never
 *   externally supplied free text.
 */
export function canonicalizeAggregateCalculationScope(
  declaredScopeIdentifier: string,
  inputs: CanonicalScopeInputs,
): string {
  const measurementPart = [...inputs.inputMeasurementIds].sort().join(",");
  const geometryPart = inputs.inputGeometryRefs
    .map((ref) => `${ref.geometryId}@v${ref.version}`)
    .sort()
    .join(",");
  const derivedPart = [...inputs.inputDerivedMeasurementIds].sort().join(",");
  return `${declaredScopeIdentifier}|M:${measurementPart}|G:${geometryPart}|D:${derivedPart}`;
}
