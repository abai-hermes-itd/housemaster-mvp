/**
 * ScopeItem — MUTABLE_OPERATIONAL_STATE repository.
 *
 * Allows: create, read, complete() (the one-way PENDING -> DONE terminal
 * transition), and skip() (the one-way PENDING -> SKIPPED terminal
 * transition). No generic update() is exposed — every mutation path is
 * a dedicated method that enforces its own frozen lifecycle rule.
 */
import type { ScopeItem } from "../../domain/types/ScopeItem.ts";
import type { ActorId, ScopeItemId, SessionId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { MutableOperationalStateRuleViolationError } from "../guards/errors.ts";

const table = db.scopeItem;

export const scopeItemRepository = {
  /**
   * Creation rules (DOMAIN_MODEL.md §ScopeItem, PERSISTENCE_AND_
   * IMMUTABILITY.md §ScopeItem): assignmentId and targetId must already
   * exist, status must be PENDING (DONE/SKIPPED-at-create is not
   * supported), and every terminal-transition field must be absent.
   * Deliberately does NOT check assignmentId's buildingId against
   * targetId's buildingId — that cross-check was explicitly classified
   * DEFERRED_SAFE_FOR_MVP, not a frozen rule.
   */
  async create(scopeItem: ScopeItem): Promise<ScopeItemId> {
    return db.transaction("rw", table, db.surveyAssignment, db.spatialTarget, async () => {
      const assignment = await db.surveyAssignment.get(scopeItem.assignmentId);
      if (!assignment) {
        throw new MutableOperationalStateRuleViolationError(
          `ScopeItem "${scopeItem.scopeItemId}": assignmentId "${scopeItem.assignmentId}" does not exist.`,
        );
      }

      const target = await db.spatialTarget.get(scopeItem.targetId);
      if (!target) {
        throw new MutableOperationalStateRuleViolationError(
          `ScopeItem "${scopeItem.scopeItemId}": targetId "${scopeItem.targetId}" does not exist.`,
        );
      }

      if (scopeItem.status !== "PENDING") {
        throw new MutableOperationalStateRuleViolationError(
          `ScopeItem "${scopeItem.scopeItemId}": must be created with status PENDING — ` +
            `DONE/SKIPPED-at-create is not supported.`,
        );
      }
      if (
        scopeItem.fulfillingSessionId !== undefined ||
        scopeItem.completedBy !== undefined ||
        scopeItem.completedAt !== undefined ||
        scopeItem.skippedBy !== undefined ||
        scopeItem.skippedAt !== undefined ||
        scopeItem.skipReason !== undefined
      ) {
        throw new MutableOperationalStateRuleViolationError(
          `ScopeItem "${scopeItem.scopeItemId}": fulfillingSessionId/completedBy/completedAt/skippedBy/` +
            `skippedAt/skipReason must all be absent at creation — they are written only, atomically, ` +
            `by complete()/skip().`,
        );
      }

      return table.add(scopeItem);
    });
  },

  async getById(scopeItemId: ScopeItemId): Promise<ScopeItem | undefined> {
    return table.get(scopeItemId);
  },

  /**
   * Completion (the PENDING -> DONE terminal transition): completedBy
   * must resolve to an ACTIVE HUMAN_OPERATOR; fulfillingSessionId is a
   * plain SessionId capture (no MeasurementSession existence check —
   * see ScopeItem.ts's module doc comment for why). All three fields
   * are written together with status in one atomic update.
   */
  async complete(
    scopeItemId: ScopeItemId,
    fields: { completedBy: ActorId; completedAt: string; fulfillingSessionId: SessionId },
  ): Promise<void> {
    await db.transaction("rw", table, db.actorRef, async () => {
      const existing = await table.get(scopeItemId);
      if (!existing) {
        throw new MutableOperationalStateRuleViolationError(`ScopeItem "${scopeItemId}" was not found.`);
      }
      if (existing.status !== "PENDING") {
        throw new MutableOperationalStateRuleViolationError(
          `ScopeItem "${scopeItemId}": completion is only allowed from PENDING (current: "${existing.status}") — ` +
            `DONE/SKIPPED are terminal, no reopen in MVP.`,
        );
      }

      await assertActorType(db.actorRef, fields.completedBy, ["HUMAN_OPERATOR"]);

      await table.update(scopeItemId, {
        status: "DONE",
        completedBy: fields.completedBy,
        completedAt: fields.completedAt,
        fulfillingSessionId: fields.fulfillingSessionId,
      });
    });
  },

  /**
   * Skip (the PENDING -> SKIPPED terminal transition): skippedBy must
   * resolve to an ACTIVE HUMAN_OPERATOR. fulfillingSessionId is never
   * written here — it remains permanently absent on a SKIPPED row.
   */
  async skip(
    scopeItemId: ScopeItemId,
    fields: { skippedBy: ActorId; skippedAt: string; skipReason: string },
  ): Promise<void> {
    await db.transaction("rw", table, db.actorRef, async () => {
      const existing = await table.get(scopeItemId);
      if (!existing) {
        throw new MutableOperationalStateRuleViolationError(`ScopeItem "${scopeItemId}" was not found.`);
      }
      if (existing.status !== "PENDING") {
        throw new MutableOperationalStateRuleViolationError(
          `ScopeItem "${scopeItemId}": skip is only allowed from PENDING (current: "${existing.status}") — ` +
            `DONE/SKIPPED are terminal, no reopen in MVP.`,
        );
      }

      await assertActorType(db.actorRef, fields.skippedBy, ["HUMAN_OPERATOR"]);

      await table.update(scopeItemId, {
        status: "SKIPPED",
        skippedBy: fields.skippedBy,
        skippedAt: fields.skippedAt,
        skipReason: fields.skipReason,
      });
    });
  },
};
