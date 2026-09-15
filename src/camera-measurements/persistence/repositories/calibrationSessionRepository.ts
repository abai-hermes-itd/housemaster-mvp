/**
 * CalibrationSession — APPEND_ONLY_FACT repository.
 */
import type { CalibrationSession } from "../../domain/types/CalibrationSession.ts";
import type { CalibrationSessionId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.calibrationSession;
const base = createAppendOnlyRepository<CalibrationSession, CalibrationSessionId>(
  table,
  "calibrationSession",
);

export const calibrationSessionRepository = {
  ...base,

  async create(session: CalibrationSession): Promise<CalibrationSessionId> {
    await assertActorType(db.actorRef, session.actorId, ["HUMAN_OPERATOR"]);

    if (session.supersedesCalibrationSessionId) {
      const predecessor = await table.get(session.supersedesCalibrationSessionId);
      if (!predecessor) {
        throw new ReferenceIdentityRuleViolationError(
          `CalibrationSession "${session.calibrationSessionId}": supersedesCalibrationSessionId "${session.supersedesCalibrationSessionId}" does not exist.`,
        );
      }
    }

    return table.add(session);
  },
};
