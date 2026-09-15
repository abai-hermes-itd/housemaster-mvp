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

  async create(record: FormulaDefinition): Promise<[FormulaType, number]> {
    // Only frozen FormulaType values allowed — enforced at the persistence
    // boundary itself, not merely by the TS union type, which a caller
    // can always bypass.
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
