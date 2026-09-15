/**
 * FormulaDefinition — VERSIONED_APPEND_ONLY repository.
 */
import { FROZEN_FORMULA_TYPES } from "../../domain/types/FormulaDefinition.ts";
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
