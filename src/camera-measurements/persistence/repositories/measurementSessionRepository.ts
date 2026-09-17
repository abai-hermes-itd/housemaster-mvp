/**
 * MeasurementSession — MUTABLE_OPERATIONAL_STATE repository.
 *
 * Allows: create, read, and close() (the one-way OPEN -> CLOSED terminal
 * transition, HD-MS-01/HD-MS-03). No generic update() is exposed —
 * every mutation path is a dedicated method that enforces its own
 * frozen lifecycle rule.
 */
import type { MeasurementSession } from "../../domain/types/MeasurementSession.ts";
import type { ActorId, SessionId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { MutableOperationalStateRuleViolationError } from "../guards/errors.ts";

const table = db.measurementSession;

export const measurementSessionRepository = {
  /**
   * Creation rules (DOMAIN_MODEL.md §MeasurementSession, HD-MS-01,
   * HD-MS-02, HD-MS-03): scopeItemId and targetId must already exist,
   * targetId must equal the parent ScopeItem's own targetId (HD-MS-03),
   * openedBy must resolve to an ACTIVE HUMAN_OPERATOR (HD-MS-01),
   * status must be OPEN, and closedBy/closedAt must both be absent —
   * they are written only, atomically, by close(). No calibration
   * field exists on this entity — HD-MS-02, source of truth remains
   * Measurement.calibrationSessionId.
   */
  async create(session: MeasurementSession): Promise<SessionId> {
    return db.transaction("rw", table, db.scopeItem, db.spatialTarget, db.actorRef, async () => {
      const scopeItem = await db.scopeItem.get(session.scopeItemId);
      if (!scopeItem) {
        throw new MutableOperationalStateRuleViolationError(
          `MeasurementSession "${session.sessionId}": scopeItemId "${session.scopeItemId}" does not exist.`,
        );
      }

      const target = await db.spatialTarget.get(session.targetId);
      if (!target) {
        throw new MutableOperationalStateRuleViolationError(
          `MeasurementSession "${session.sessionId}": targetId "${session.targetId}" does not exist.`,
        );
      }

      if (session.targetId !== scopeItem.targetId) {
        throw new MutableOperationalStateRuleViolationError(
          `MeasurementSession "${session.sessionId}": targetId "${session.targetId}" does not equal parent ` +
            `ScopeItem "${session.scopeItemId}"'s own targetId "${scopeItem.targetId}" (HD-MS-03).`,
        );
      }

      await assertActorType(db.actorRef, session.openedBy, ["HUMAN_OPERATOR"]);

      if (session.status !== "OPEN") {
        throw new MutableOperationalStateRuleViolationError(
          `MeasurementSession "${session.sessionId}": must be created with status OPEN — ` +
            `CLOSED-at-create is not supported.`,
        );
      }
      if (session.closedBy !== undefined || session.closedAt !== undefined) {
        throw new MutableOperationalStateRuleViolationError(
          `MeasurementSession "${session.sessionId}": closedBy/closedAt must be absent at creation — ` +
            `they are written only, atomically, at the OPEN -> CLOSED transition.`,
        );
      }

      return table.add(session);
    });
  },

  async getById(sessionId: SessionId): Promise<MeasurementSession | undefined> {
    return table.get(sessionId);
  },

  /**
   * Closure: the one-way OPEN -> CLOSED terminal transition. closedBy
   * must resolve to an ACTIVE HUMAN_OPERATOR; closedBy and closedAt are
   * written once, together, atomically. No repository method can ever
   * revisit a CLOSED row's closedBy/closedAt — every mutation method
   * rejects outright once status is no longer OPEN, so both fields are
   * immutable by construction. Continuation after closure is always a
   * new, independent MeasurementSession — no successor/predecessor
   * pointer exists on this entity.
   */
  async close(sessionId: SessionId, fields: { closedBy: ActorId; closedAt: string }): Promise<void> {
    await db.transaction("rw", table, db.actorRef, async () => {
      const existing = await table.get(sessionId);
      if (!existing) {
        throw new MutableOperationalStateRuleViolationError(`MeasurementSession "${sessionId}" was not found.`);
      }
      if (existing.status !== "OPEN") {
        throw new MutableOperationalStateRuleViolationError(
          `MeasurementSession "${sessionId}" is already CLOSED — this is a terminal, one-way transition ` +
            `with no reopen in MVP.`,
        );
      }

      await assertActorType(db.actorRef, fields.closedBy, ["HUMAN_OPERATOR"]);

      await table.update(sessionId, {
        status: "CLOSED",
        closedBy: fields.closedBy,
        closedAt: fields.closedAt,
      });
    });
  },
};
