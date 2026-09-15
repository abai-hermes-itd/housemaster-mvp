/**
 * DerivedMeasurement — VERSIONED_APPEND_ONLY repository.
 */
import type { DerivedMeasurement } from "../../domain/types/DerivedMeasurement.ts";
import { AGGREGATE_FORMULA_TYPES, canonicalizeAggregateCalculationScope } from "../../domain/types/DerivedMeasurement.ts";
import type { DerivedMeasurementId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { VersionedAppendOnlyRuleViolationError } from "../guards/errors.ts";

const table = db.derivedMeasurement;
const base = createAppendOnlyRepository<DerivedMeasurement, DerivedMeasurementId>(table, "derivedMeasurement");

export const derivedMeasurementRepository = {
  ...base,

  /**
   * G1-05B-R2 finding R2-03: formula-reference validation, predecessor
   * validation, semanticResultKey comparison, successor-uniqueness
   * check, and insert must be one atomic operation. The entire method
   * body now runs inside one Dexie read-write transaction spanning both
   * `derivedMeasurement` and `formulaDefinition`, so IndexedDB
   * serializes concurrent callers against each other.
   */
  async create(record: DerivedMeasurement): Promise<DerivedMeasurementId> {
    return db.transaction("rw", table, db.formulaDefinition, async () => {
      // The exact formulaDefinition identity/version must be pinned to an
      // existing row — FORMULA_AND_DERIVATION_CONTRACT.md §DerivedMeasurement.
      const formulaDefinition = await db.formulaDefinition.get([record.formulaType, record.formulaVersion]);
      if (!formulaDefinition) {
        throw new VersionedAppendOnlyRuleViolationError(
          `DerivedMeasurement "${record.derivedMeasurementId}": pinned FormulaDefinition ` +
            `"${record.formulaType}"@v${record.formulaVersion} does not exist.`,
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
      const isAggregateFormula = AGGREGATE_FORMULA_TYPES.includes(record.formulaType);
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
