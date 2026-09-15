/**
 * Measurement — APPEND_ONLY_FACT repository. The single most protected
 * entity in the model.
 */
import type { Measurement } from "../../domain/types/Measurement.ts";
import type { MeasurementId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.measurement;
const base = createAppendOnlyRepository<Measurement, MeasurementId>(table, "measurement");

export const measurementRepository = {
  ...base,

  async create(measurement: Measurement): Promise<MeasurementId> {
    // Create Measurement: REQUIRED, HUMAN_OPERATOR (never AGENT, even via
    // an accepted Proposal) — IDENTITY_AND_ACCOUNTABILITY.md.
    await assertActorType(db.actorRef, measurement.actorId, ["HUMAN_OPERATOR"]);

    if (measurement.entryMethod === "IMPORTED_HISTORIC" && !measurement.sourceRef) {
      throw new ReferenceIdentityRuleViolationError(
        `Measurement "${measurement.measurementId}": sourceRef is required when entryMethod is IMPORTED_HISTORIC.`,
      );
    }
    if (measurement.entryMethod === "SYSTEM_ASSUMED" && !measurement.assumptionReason) {
      throw new ReferenceIdentityRuleViolationError(
        `Measurement "${measurement.measurementId}": assumptionReason is required when entryMethod is SYSTEM_ASSUMED.`,
      );
    }
    if (measurement.entryMethod === "CAMERA_OBSERVED" && !measurement.calibrationSessionId) {
      throw new ReferenceIdentityRuleViolationError(
        `Measurement "${measurement.measurementId}": calibrationSessionId is required when entryMethod is CAMERA_OBSERVED.`,
      );
    }

    if (measurement.correctsMeasurementId) {
      const predecessor = await table.get(measurement.correctsMeasurementId);
      if (!predecessor) {
        throw new ReferenceIdentityRuleViolationError(
          `Measurement "${measurement.measurementId}": correctsMeasurementId "${measurement.correctsMeasurementId}" does not exist.`,
        );
      }
    }

    if (measurement.calibrationSessionId) {
      const calibration = await db.calibrationSession.get(measurement.calibrationSessionId);
      if (!calibration) {
        throw new ReferenceIdentityRuleViolationError(
          `Measurement "${measurement.measurementId}": calibrationSessionId "${measurement.calibrationSessionId}" does not exist.`,
        );
      }
    }

    if (measurement.acceptingDecisionId) {
      const decision = await db.decision.get(measurement.acceptingDecisionId);
      if (!decision) {
        throw new ReferenceIdentityRuleViolationError(
          `Measurement "${measurement.measurementId}": acceptingDecisionId "${measurement.acceptingDecisionId}" does not exist.`,
        );
      }
      if (decision.outcome !== "ACCEPTED") {
        throw new ReferenceIdentityRuleViolationError(
          `Measurement "${measurement.measurementId}": acceptingDecisionId must reference an ACCEPTED Decision.`,
        );
      }
    }

    return table.add(measurement);
  },
};
