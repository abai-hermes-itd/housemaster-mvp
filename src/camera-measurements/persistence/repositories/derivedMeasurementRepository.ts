/**
 * DerivedMeasurement — VERSIONED_APPEND_ONLY repository.
 */
import type { DerivedMeasurement } from "../../domain/types/DerivedMeasurement.ts";
import { AGGREGATE_FORMULA_TYPES, canonicalizeAggregateCalculationScope } from "../../domain/types/DerivedMeasurement.ts";
import type { DerivedMeasurementId } from "../../domain/ids/ids.ts";
import type { FormulaType } from "../../domain/types/FormulaDefinition.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { VersionedAppendOnlyRuleViolationError } from "../guards/errors.ts";

const table = db.derivedMeasurement;
const base = createAppendOnlyRepository<DerivedMeasurement, DerivedMeasurementId>(table, "derivedMeasurement");

/**
 * formulaTypes whose overlap acknowledgement is mandatory whenever 2+
 * spatially-relevant inputs are combined — FORMULA_AND_DERIVATION_CONTRACT.md
 * §"Dedup & Overlap Rules". `DEFECT_LENGTH_TOTAL` is explicitly excluded
 * there (linear-defect double-counting is the dedup rule's problem, not a
 * true overlap problem).
 */
const OVERLAP_ACK_REQUIRED_FORMULA_TYPES: readonly FormulaType[] = [
  "GROSS_MINUS_OPENINGS",
  "AGGREGATE_SUM",
  "DEFECT_AREA_TOTAL",
];

export const derivedMeasurementRepository = {
  ...base,

  /**
   * G1-05B-R2 finding R2-03: formula-reference validation, predecessor
   * validation, semanticResultKey comparison, successor-uniqueness
   * check, and insert must be one atomic operation. The entire method
   * body now runs inside one Dexie read-write transaction spanning
   * `derivedMeasurement`, `formulaDefinition`, `spatialTarget`, and
   * `geometry`, so IndexedDB serializes concurrent callers against each
   * other.
   *
   * G1-05B-SH2: three previously-unenforced write-time rules from
   * FORMULA_AND_DERIVATION_CONTRACT.md are now checked here, using only
   * stores already available in G1-04/G1-05B's own scope (spatialTarget,
   * geometry, formulaDefinition, derivedMeasurement) — no G1-05C entity
   * is required or referenced:
   *   1. formulaType -> allowedTargetTypes / requiredGeometryType
   *      applicability ("checked at DerivedMeasurement write time").
   *   2. AGGREGATE_SUM/DEFECT_AREA_TOTAL/DEFECT_LENGTH_TOTAL's input
   *      contract: same outputQuantityType, same semanticCategory,
   *      exactly one distinct + applicable source targetType, no
   *      duplicate source targetId ("Dedup & Overlap Rules").
   *   3. Mandatory overlap acknowledgement for 2+ spatially-relevant
   *      inputs on GROSS_MINUS_OPENINGS/AGGREGATE_SUM/DEFECT_AREA_TOTAL.
   *
   * G1-05B-GMO-IMP-01: GROSS_MINUS_OPENINGS's host/openings structural
   * split (`grossSourceDerivedMeasurementId` vs. `inputDerivedMeasurementIds`)
   * is now validated — see the dedicated block below and
   * FORMULA_AND_DERIVATION_CONTRACT.md §"GROSS_MINUS_OPENINGS —
   * host/openings structural split".
   */
  async create(record: DerivedMeasurement): Promise<DerivedMeasurementId> {
    return db.transaction("rw", table, db.formulaDefinition, db.spatialTarget, db.geometry, async () => {
      // The exact formulaDefinition identity/version must be pinned to an
      // existing row — FORMULA_AND_DERIVATION_CONTRACT.md §DerivedMeasurement.
      const formulaDefinition = await db.formulaDefinition.get([record.formulaType, record.formulaVersion]);
      if (!formulaDefinition) {
        throw new VersionedAppendOnlyRuleViolationError(
          `DerivedMeasurement "${record.derivedMeasurementId}": pinned FormulaDefinition ` +
            `"${record.formulaType}"@v${record.formulaVersion} does not exist.`,
        );
      }

      const isAggregateFormula = AGGREGATE_FORMULA_TYPES.includes(record.formulaType);
      const isGrossMinusOpenings = record.formulaType === "GROSS_MINUS_OPENINGS";

      // --- grossSourceDerivedMeasurementId: required iff GROSS_MINUS_OPENINGS, forbidden otherwise ---
      if (isGrossMinusOpenings && record.grossSourceDerivedMeasurementId === undefined) {
        throw new VersionedAppendOnlyRuleViolationError(
          `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "GROSS_MINUS_OPENINGS" requires ` +
            `grossSourceDerivedMeasurementId.`,
        );
      }
      if (!isGrossMinusOpenings && record.grossSourceDerivedMeasurementId !== undefined) {
        throw new VersionedAppendOnlyRuleViolationError(
          `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId is only valid ` +
            `for formulaType "GROSS_MINUS_OPENINGS", not "${record.formulaType}".`,
        );
      }

      // --- Applicability, part 1: formulaType -> allowedTargetTypes ---
      // For single-subject formulas (RECTANGLE_AREA, POLYGON_AREA, VOLUME,
      // POLYLINE_LENGTH) and for GROSS_MINUS_OPENINGS's own host,
      // `record.targetId` IS the checked subject. For the 3 pure
      // source-list aggregates, `record.targetId` is the aggregation
      // scope (e.g. a shared parentTargetId), not a source — checked
      // instead, per source, below.
      if (!isAggregateFormula) {
        const subjectTarget = await db.spatialTarget.get(record.targetId);
        if (!subjectTarget) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": targetId "${record.targetId}" does not ` +
              `reference an existing SpatialTarget.`,
          );
        }
        if (!formulaDefinition.allowedTargetTypes.includes(subjectTarget.targetType)) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "${record.formulaType}" is not ` +
              `applicable to targetType "${subjectTarget.targetType}" — see FORMULA_AND_DERIVATION_CONTRACT.md's ` +
              `applicability table.`,
          );
        }
      }

      // --- Applicability, part 2: formulaType -> requiredGeometryType ---
      if (formulaDefinition.requiredGeometryType !== "NONE") {
        if (record.inputGeometryRefs.length === 0) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "${record.formulaType}" requires ` +
              `a "${formulaDefinition.requiredGeometryType}" geometry input, but none was pinned.`,
          );
        }
        for (const ref of record.inputGeometryRefs) {
          const geometry = await db.geometry.get([ref.geometryId, ref.version]);
          if (!geometry) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": pinned Geometry "${ref.geometryId}"@v` +
                `${ref.version} does not exist.`,
            );
          }
          if (geometry.primitiveType !== formulaDefinition.requiredGeometryType) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "${record.formulaType}" ` +
                `requires "${formulaDefinition.requiredGeometryType}" geometry, but pinned Geometry ` +
                `"${ref.geometryId}"@v${ref.version} is "${geometry.primitiveType}".`,
            );
          }
        }
      }

      // --- Source-list input contract (AGGREGATE_SUM/DEFECT_AREA_TOTAL/
      // DEFECT_LENGTH_TOTAL): same outputQuantityType, same
      // semanticCategory, exactly one distinct + applicable source
      // targetType, no duplicate source targetId. ---
      if (isAggregateFormula) {
        if (record.inputDerivedMeasurementIds.length === 0) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "${record.formulaType}" requires ` +
              `at least one source DerivedMeasurement.`,
          );
        }
        const seenSourceTargetIds = new Set<string>();
        const seenSourceTargetTypes = new Set<string>();
        for (const sourceId of record.inputDerivedMeasurementIds) {
          const source = await table.get(sourceId);
          if (!source) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": source DerivedMeasurement "${sourceId}" ` +
                `does not exist.`,
            );
          }
          if (source.outputQuantityType !== record.outputQuantityType) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": source "${sourceId}" has outputQuantityType ` +
                `"${source.outputQuantityType}", but this record declares "${record.outputQuantityType}" — all ` +
                `sources must share the same outputQuantityType.`,
            );
          }
          if (source.semanticCategory !== record.semanticCategory) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": source "${sourceId}" has semanticCategory ` +
                `"${source.semanticCategory}", but this record declares "${record.semanticCategory}" — all ` +
                `sources must share the same semanticCategory.`,
            );
          }
          if (seenSourceTargetIds.has(source.targetId)) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": duplicate source targetId ` +
                `"${source.targetId}" — an aggregate's input set may include at most one source per targetId.`,
            );
          }
          seenSourceTargetIds.add(source.targetId);

          const sourceTarget = await db.spatialTarget.get(source.targetId);
          if (!sourceTarget) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": source "${sourceId}"'s targetId ` +
                `"${source.targetId}" does not reference an existing SpatialTarget.`,
            );
          }
          if (!formulaDefinition.allowedTargetTypes.includes(sourceTarget.targetType)) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": source "${sourceId}"'s targetType ` +
                `"${sourceTarget.targetType}" is not a valid source for formulaType "${record.formulaType}".`,
            );
          }
          seenSourceTargetTypes.add(sourceTarget.targetType);
        }
        if (seenSourceTargetTypes.size > 1) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": sources span ${seenSourceTargetTypes.size} ` +
              `distinct targetTypes (${[...seenSourceTargetTypes].join(", ")}) — exactly one explicit source ` +
              `targetType is required.`,
          );
        }
      }

      // --- GROSS_MINUS_OPENINGS host/openings structural validation
      // (FORMULA_AND_DERIVATION_CONTRACT.md §"GROSS_MINUS_OPENINGS —
      // host/openings structural split"). record.targetId's own
      // applicability (FACADE/ROOF) was already checked above via the
      // non-aggregate branch, since GROSS_MINUS_OPENINGS is not in
      // AGGREGATE_FORMULA_TYPES. ---
      if (isGrossMinusOpenings) {
        const grossSourceId = record.grossSourceDerivedMeasurementId;
        if (grossSourceId === undefined) {
          // Unreachable — guarded above — but keeps this block self-contained for TS narrowing.
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId is required.`,
          );
        }
        if (grossSourceId === record.derivedMeasurementId) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId cannot equal ` +
              `its own id (self-predecessor/cycle).`,
          );
        }

        const grossSource = await table.get(grossSourceId);
        if (!grossSource) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId ` +
              `"${grossSourceId}" does not exist.`,
          );
        }
        if (grossSource.targetId !== record.targetId) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId ` +
              `"${grossSourceId}"'s targetId "${grossSource.targetId}" does not match this record's targetId ` +
              `"${record.targetId}".`,
          );
        }
        if (grossSource.outputQuantityType !== "AREA" || grossSource.semanticCategory !== "RAW_AREA") {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId ` +
              `"${grossSourceId}" must be a gross-area result (outputQuantityType "AREA", semanticCategory ` +
              `"RAW_AREA"), but has outputQuantityType "${grossSource.outputQuantityType}"/semanticCategory ` +
              `"${grossSource.semanticCategory}".`,
          );
        }
        if (record.inputDerivedMeasurementIds.includes(grossSourceId)) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": grossSourceDerivedMeasurementId ` +
              `"${grossSourceId}" must not also appear in inputDerivedMeasurementIds (the openings list).`,
          );
        }

        if (record.inputDerivedMeasurementIds.length === 0) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "GROSS_MINUS_OPENINGS" requires ` +
              `at least one opening source in inputDerivedMeasurementIds.`,
          );
        }
        const seenOpeningTargetIds = new Set<string>();
        for (const openingId of record.inputDerivedMeasurementIds) {
          const opening = await table.get(openingId);
          if (!opening) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": opening source "${openingId}" does not exist.`,
            );
          }
          if (opening.outputQuantityType !== "AREA") {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": opening source "${openingId}" has ` +
                `outputQuantityType "${opening.outputQuantityType}", but openings must be "AREA".`,
            );
          }
          if (seenOpeningTargetIds.has(opening.targetId)) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": duplicate opening source targetId ` +
                `"${opening.targetId}" — at most one opening per source targetId is allowed.`,
            );
          }
          seenOpeningTargetIds.add(opening.targetId);

          const openingTarget = await db.spatialTarget.get(opening.targetId);
          if (!openingTarget) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": opening source "${openingId}"'s targetId ` +
                `"${opening.targetId}" does not reference an existing SpatialTarget.`,
            );
          }
          if (openingTarget.targetType !== "OPENING") {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": opening source "${openingId}"'s targetType ` +
                `"${openingTarget.targetType}" is not "OPENING".`,
            );
          }
          if (openingTarget.parentTargetId !== record.targetId) {
            throw new VersionedAppendOnlyRuleViolationError(
              `DerivedMeasurement "${record.derivedMeasurementId}": opening source "${openingId}"'s target ` +
                `parentTargetId "${openingTarget.parentTargetId}" does not match this record's (the host's) ` +
                `targetId "${record.targetId}".`,
            );
          }
        }
      }

      // --- Mandatory overlap acknowledgement for 2+ spatially-relevant
      // inputs on GROSS_MINUS_OPENINGS/AGGREGATE_SUM/DEFECT_AREA_TOTAL.
      // For GROSS_MINUS_OPENINGS, the host counts as one additional
      // spatially-relevant input alongside the openings list. ---
      const spatiallyRelevantInputCount =
        (isGrossMinusOpenings && record.grossSourceDerivedMeasurementId !== undefined ? 1 : 0) +
        record.inputMeasurementIds.length + record.inputGeometryRefs.length + record.inputDerivedMeasurementIds.length;
      if (
        OVERLAP_ACK_REQUIRED_FORMULA_TYPES.includes(record.formulaType) &&
        spatiallyRelevantInputCount >= 2 &&
        (!record.overlapReviewedBy || !record.overlapReviewedAt)
      ) {
        throw new VersionedAppendOnlyRuleViolationError(
          `DerivedMeasurement "${record.derivedMeasurementId}": formulaType "${record.formulaType}" combines ` +
            `${spatiallyRelevantInputCount} spatially-relevant inputs — overlapReviewedBy/overlapReviewedAt are ` +
            `mandatory (FORMULA_AND_DERIVATION_CONTRACT.md §"Dedup & Overlap Rules").`,
        );
      }

      // For an aggregate formulaType, calculationScope must itself
      // canonically capture the declared scope identifier AND the exact
      // resolved input set (FORMULA_AND_DERIVATION_CONTRACT.md
      // §"calculationScope"; see DerivedMeasurement.ts's field comment,
      // G1-05B-R finding #1, and G1-05B-R2 finding R2-04). This is the
      // single authoritative place that transformation happens —
      // whatever raw scope label the caller passed in
      // `record.calculationScope` is combined with the record's own
      // pinned input arrays here; the caller cannot bypass it by
      // pre-composing a "canonical-looking" string themselves, since
      // this function recomputes it from the actual pinned inputs
      // regardless. Non-aggregate formulas are stored exactly as the
      // caller supplied — existing behavior, unchanged.
      const canonicalCalculationScope = isAggregateFormula
        ? canonicalizeAggregateCalculationScope(record.calculationScope, {
            inputMeasurementIds: record.inputMeasurementIds,
            inputGeometryRefs: record.inputGeometryRefs,
            inputDerivedMeasurementIds: record.inputDerivedMeasurementIds,
          })
        : record.calculationScope;

      if (record.supersedesDerivedMeasurementId !== undefined) {
        if (record.supersedesDerivedMeasurementId === record.derivedMeasurementId) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": supersedesDerivedMeasurementId cannot ` +
              `equal its own id (self-predecessor/cycle).`,
          );
        }

        const predecessor = await table.get(record.supersedesDerivedMeasurementId);
        if (!predecessor) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": supersedesDerivedMeasurementId ` +
              `"${record.supersedesDerivedMeasurementId}" does not exist.`,
          );
        }

        // Supersession is permitted only within an identical
        // semanticResultKey. `predecessor.calculationScope` was already
        // stored in its own canonical form at its own creation; compare
        // it against THIS record's freshly-computed canonical value,
        // never the caller's raw, pre-canonicalization input.
        const sameSemanticResultKey =
          predecessor.targetId === record.targetId &&
          predecessor.outputQuantityType === record.outputQuantityType &&
          predecessor.semanticCategory === record.semanticCategory &&
          predecessor.calculationScope === canonicalCalculationScope;
        if (!sameSemanticResultKey) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.derivedMeasurementId}": supersession is only permitted within an ` +
              `identical semanticResultKey (targetId, outputQuantityType, semanticCategory, calculationScope).`,
          );
        }

        const existingSuccessor = await table
          .filter((row) => row.supersedesDerivedMeasurementId === record.supersedesDerivedMeasurementId)
          .first();
        if (existingSuccessor) {
          throw new VersionedAppendOnlyRuleViolationError(
            `DerivedMeasurement "${record.supersedesDerivedMeasurementId}" already has a successor ` +
              `("${existingSuccessor.derivedMeasurementId}") — the chain must remain linear.`,
          );
        }
      }

      return table.add({ ...record, calculationScope: canonicalCalculationScope });
    });
  },
};
