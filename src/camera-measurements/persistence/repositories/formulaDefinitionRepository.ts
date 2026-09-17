/**
 * FormulaDefinition — VERSIONED_APPEND_ONLY repository.
 */
import {
  CANONICAL_ALLOWED_TARGET_TYPES,
  CANONICAL_OUTPUT_QUANTITY_TYPE_ONLY,
  CANONICAL_QUANTITY_CATEGORY,
  CANONICAL_REQUIRED_GEOMETRY_TYPE,
  FROZEN_FORMULA_TYPES,
} from "../../domain/types/FormulaDefinition.ts";
import type { FormulaDefinition, FormulaLifecycleStatus, FormulaType } from "../../domain/types/FormulaDefinition.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { DuplicateVersionError, VersionedAppendOnlyRuleViolationError } from "../guards/errors.ts";

const table = db.formulaDefinition;
const base = createAppendOnlyRepository<FormulaDefinition, [FormulaType, number]>(table, "formulaDefinition");

export const formulaDefinitionRepository = {
  ...base,

  /**
   * G1-05B-R2 finding R2-02: the predecessor check, the existing-successor
   * (branching) check, and the insert must be one atomic operation — two
   * concurrent create() calls both targeting the same predecessor could
   * otherwise both pass the "no existing successor" check before either
   * had committed. The entire method body now runs inside one Dexie
   * read-write transaction over `formulaDefinition`, so IndexedDB
   * serializes concurrent callers against each other.
   */
  async create(record: FormulaDefinition): Promise<[FormulaType, number]> {
    return db.transaction("rw", table, async () => {
      // Only frozen FormulaType values allowed — enforced at the
      // persistence boundary itself, not merely by the TS union type,
      // which a caller can always bypass.
      if (!(FROZEN_FORMULA_TYPES as readonly string[]).includes(record.formulaType)) {
        throw new VersionedAppendOnlyRuleViolationError(
          `FormulaDefinition: "${record.formulaType}" is not one of the 8 frozen formulaType values ` +
            `(${FROZEN_FORMULA_TYPES.join(", ")}).`,
        );
      }

      // --- SF-02B: canonical FormulaDefinition semantic enforcement ---
      // allowedTargetTypes and requiredGeometryType are fully determinable
      // from FORMULA_AND_DERIVATION_CONTRACT.md for all 8 formulaTypes and
      // are enforced without exception (exact-set / exact-value match).
      const canonicalAllowedTargetTypes = CANONICAL_ALLOWED_TARGET_TYPES[record.formulaType];
      const actualTargetTypes = new Set(record.allowedTargetTypes);
      const canonicalTargetTypes = new Set(canonicalAllowedTargetTypes);
      const allowedTargetTypesMatch =
        actualTargetTypes.size === canonicalTargetTypes.size &&
        [...actualTargetTypes].every((t) => canonicalTargetTypes.has(t));
      if (!allowedTargetTypesMatch) {
        throw new VersionedAppendOnlyRuleViolationError(
          `FormulaDefinition "${record.formulaType}": allowedTargetTypes must exactly match the frozen ` +
            `applicability table (${canonicalAllowedTargetTypes.join(", ")}), got (${record.allowedTargetTypes.join(", ")}).`,
        );
      }

      const canonicalGeometryType = CANONICAL_REQUIRED_GEOMETRY_TYPE[record.formulaType];
      if (record.requiredGeometryType !== canonicalGeometryType) {
        throw new VersionedAppendOnlyRuleViolationError(
          `FormulaDefinition "${record.formulaType}": requiredGeometryType must be "${canonicalGeometryType}" ` +
            `per the frozen contract, got "${record.requiredGeometryType}".`,
        );
      }

      // outputQuantityType/semanticCategory: enforced only for the 6
      // formulaTypes SF-02A found fully determinable. AGGREGATE_SUM is
      // deliberately never checked here (genuinely category-generic by
      // design — see CANONICAL_QUANTITY_CATEGORY's doc comment).
      // POLYLINE_LENGTH's outputQuantityType is determinable and checked;
      // its semanticCategory is deferred (SF-02A DEFERRED_POLYLINE_LENGTH_FIELDS).
      const canonicalQuantityCategory = CANONICAL_QUANTITY_CATEGORY[record.formulaType];
      if (canonicalQuantityCategory) {
        if (
          record.outputQuantityType !== canonicalQuantityCategory.outputQuantityType ||
          record.semanticCategory !== canonicalQuantityCategory.semanticCategory
        ) {
          throw new VersionedAppendOnlyRuleViolationError(
            `FormulaDefinition "${record.formulaType}": outputQuantityType/semanticCategory must be ` +
              `"${canonicalQuantityCategory.outputQuantityType}"/"${canonicalQuantityCategory.semanticCategory}" ` +
              `per the frozen contract, got "${record.outputQuantityType}"/"${record.semanticCategory}".`,
          );
        }
      } else {
        const fixedOutputQuantityType = CANONICAL_OUTPUT_QUANTITY_TYPE_ONLY[record.formulaType];
        if (fixedOutputQuantityType !== undefined && record.outputQuantityType !== fixedOutputQuantityType) {
          throw new VersionedAppendOnlyRuleViolationError(
            `FormulaDefinition "${record.formulaType}": outputQuantityType must be "${fixedOutputQuantityType}" ` +
              `per the frozen contract, got "${record.outputQuantityType}".`,
          );
        }
      }

      if (record.supersedesFormulaVersion !== undefined) {
        if (record.supersedesFormulaVersion === record.version) {
          throw new VersionedAppendOnlyRuleViolationError(
            `FormulaDefinition "${record.formulaType}" v${record.version}: supersedesFormulaVersion cannot ` +
              `equal its own version (self-predecessor/cycle).`,
          );
        }

        const predecessor = await table.get([record.formulaType, record.supersedesFormulaVersion]);
        if (!predecessor) {
          throw new VersionedAppendOnlyRuleViolationError(
            `FormulaDefinition "${record.formulaType}": supersedesFormulaVersion ` +
              `${record.supersedesFormulaVersion} does not exist.`,
          );
        }

        // Guaranteed by construction (looked up via the compound key
        // [record.formulaType, ...]), asserted explicitly per R2-02.
        if (predecessor.formulaType !== record.formulaType) {
          throw new VersionedAppendOnlyRuleViolationError(
            `FormulaDefinition "${record.formulaType}": supersedesFormulaVersion resolved to a row of a ` +
              `different formulaType — supersession must stay within the same formulaType.`,
          );
        }

        const existingSuccessor = await table
          .where("formulaType")
          .equals(record.formulaType)
          .filter((row) => row.supersedesFormulaVersion === record.supersedesFormulaVersion)
          .first();
        if (existingSuccessor) {
          throw new VersionedAppendOnlyRuleViolationError(
            `FormulaDefinition "${record.formulaType}" v${record.supersedesFormulaVersion} already has a ` +
              `successor (v${existingSuccessor.version}) — the successor chain must remain linear (at most ` +
              `one successor per version).`,
          );
        }
      }

      try {
        return await table.add(record);
      } catch (err) {
        if (err instanceof Error && err.name === "ConstraintError") {
          throw new DuplicateVersionError("FormulaDefinition", `${record.formulaType}@v${record.version}`);
        }
        throw err;
      }
    });
  },

  async getVersion(formulaType: FormulaType, version: number): Promise<FormulaDefinition | undefined> {
    return table.get([formulaType, version]);
  },

  async listVersions(formulaType: FormulaType): Promise<FormulaDefinition[]> {
    return table.where("formulaType").equals(formulaType).sortBy("version");
  },

  /** ACTIVE/DEPRECATED are fully derived, never stored — PERSISTENCE_AND_IMMUTABILITY.md §FormulaDefinition. */
  async getLifecycleStatus(formulaType: FormulaType, version: number): Promise<FormulaLifecycleStatus> {
    const successor = await table
      .where("formulaType")
      .equals(formulaType)
      .filter((row) => row.supersedesFormulaVersion === version)
      .first();
    return successor ? "DEPRECATED" : "ACTIVE";
  },
};
