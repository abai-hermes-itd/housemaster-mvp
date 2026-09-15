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
 * The canonical structured shape a `calculationScope` string is a
 * `JSON.stringify()` of, for an aggregate formula. Exposed as a type only
 * for documentation/testing — the actual persisted value is always the
 * serialized string, never this object.
 */
export interface CanonicalAggregateScope {
  readonly scope: string;
  readonly measurements: readonly MeasurementId[];
  readonly geometries: readonly { readonly geometryId: GeometryId; readonly version: number }[];
  readonly derived: readonly DerivedMeasurementId[];
}

/**
 * Builds the canonical `calculationScope` value for an aggregate formula
 * as one `JSON.stringify()` of a fixed-shape object — G1-05B-R2 finding
 * R2-04: a delimiter-joined string (`scope|M:a,b|G:g@v1|D:x,y`) is not
 * formally collision-safe for arbitrary string IDs (e.g. an id itself
 * containing "," or "|" could be indistinguishable from two separate
 * ids). JSON serialization has no such ambiguity: string values are
 * quoted and escaped by `JSON.stringify` itself, so an id containing any
 * of `,`, `|`, `@v`, a quote, or a backslash can never be confused with
 * an array/field boundary.
 *
 * - Deterministic and stable across replay: the returned object is
 *   always constructed with the same four keys in the same order
 *   (`scope`, `measurements`, `geometries`, `derived`), so
 *   `JSON.stringify` produces byte-identical output for byte-identical
 *   canonical content — no timestamp, no randomness, no external
 *   dependency (`JSON.stringify` is a JS built-in).
 * - Order-independent for semantically identical input sets: each
 *   category is independently, deterministically sorted (measurements
 *   and derived ids lexicographically; geometry refs by `geometryId`
 *   then `version`) before serialization, so supplying the same ids in a
 *   different array order canonicalizes identically.
 * - Duplicate-sensitive: sorting never removes an element, so a repeated
 *   id still appears the same number of times in the canonical array —
 *   no deduplication is invented here.
 * - Geometry refs are canonicalized by their FULL composite identity
 *   (`geometryId` + `version`): the sort key is `(geometryId, version)`,
 *   so two refs sharing a `geometryId` but differing only by `version`
 *   (or vice versa) always canonicalize differently.
 * - Not a hash-only representation: the JSON output remains
 *   human-inspectable (every id appears in cleartext), and the exact ids
 *   also remain independently recoverable from `inputMeasurementIds` /
 *   `inputGeometryRefs` / `inputDerivedMeasurementIds`, which this
 *   function never removes, reorders in place, or replaces — it reads
 *   from copies, never mutating the caller's arrays.
 * - No external dependency: only `JSON.stringify` and `Array.prototype`
 *   methods are used.
 */
export function canonicalizeAggregateCalculationScope(
  declaredScopeIdentifier: string,
  inputs: CanonicalScopeInputs,
): string {
  const measurements = [...inputs.inputMeasurementIds].sort();
  const geometries = inputs.inputGeometryRefs
    .map((ref) => ({ geometryId: ref.geometryId, version: ref.version }))
    .sort((a, b) => {
      if (a.geometryId !== b.geometryId) {
        return a.geometryId < b.geometryId ? -1 : 1;
      }
      return a.version - b.version;
    });
  const derived = [...inputs.inputDerivedMeasurementIds].sort();

  const canonical: CanonicalAggregateScope = {
    scope: declaredScopeIdentifier,
    measurements,
    geometries,
    derived,
  };
  return JSON.stringify(canonical);
}
