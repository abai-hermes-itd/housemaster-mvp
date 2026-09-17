/**
 * SurveyAssignment — MUTABLE_OPERATIONAL_STATE repository.
 *
 * Allows: create, read, reassign() (only while OPEN), and close() (the
 * one-way OPEN -> CLOSED terminal transition, HD-01A). No generic
 * update() is exposed — every mutation path is a dedicated method that
 * enforces its own frozen lifecycle rule; an unconstrained update()
 * would let a caller bypass reassignment/closure invariants entirely.
 */
import type { ReassignmentHistoryEntry, SurveyAssignment } from "../../domain/types/SurveyAssignment.ts";
import type { ActorId, AssignmentId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { MutableOperationalStateRuleViolationError } from "../guards/errors.ts";

const table = db.surveyAssignment;

export const surveyAssignmentRepository = {
  /**
   * Creation rules (DOMAIN_MODEL.md §SurveyAssignment, HD-01, HD-01A):
   * buildingId must already exist, assignedOperator must resolve to an
   * ACTIVE HUMAN_OPERATOR, status must be OPEN (CLOSED-at-create is not
   * supported), and closedBy/closedAt/reassignmentHistory must all be
   * empty/absent — they are written only by close()/reassign().
   */
  async create(assignment: SurveyAssignment): Promise<AssignmentId> {
    return db.transaction("rw", table, db.building, db.actorRef, async () => {
      const building = await db.building.get(assignment.buildingId);
      if (!building) {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignment.assignmentId}": buildingId "${assignment.buildingId}" does not exist.`,
        );
      }

      await assertActorType(db.actorRef, assignment.assignedOperator, ["HUMAN_OPERATOR"]);

      if (assignment.status !== "OPEN") {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignment.assignmentId}": must be created with status OPEN — ` +
            `CLOSED-at-create is not supported (HD-01/HD-01A).`,
        );
      }
      if (assignment.closedBy !== undefined || assignment.closedAt !== undefined) {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignment.assignmentId}": closedBy/closedAt must be absent at creation — ` +
            `they are written only, atomically, at the OPEN -> CLOSED transition (HD-01A).`,
        );
      }
      if (assignment.reassignmentHistory.length > 0) {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignment.assignmentId}": reassignmentHistory must be empty at creation — ` +
            `every entry is written only by reassign().`,
        );
      }

      return table.add(assignment);
    });
  },

  async getById(assignmentId: AssignmentId): Promise<SurveyAssignment | undefined> {
    return table.get(assignmentId);
  },

  /**
   * Reassignment (PERSISTENCE_AND_IMMUTABILITY.md §SurveyAssignment):
   * allowed only while OPEN. fromOperator must equal the current
   * assignedOperator; toOperator and changedBy must each resolve to an
   * ACTIVE HUMAN_OPERATOR. Appends exactly one immutable history entry
   * — prior entries are never rewritten — and assignedOperator becomes
   * toOperator atomically with that append.
   */
  async reassign(
    assignmentId: AssignmentId,
    entry: { fromOperator: ActorId; toOperator: ActorId; changedBy: ActorId; changedAt: string },
  ): Promise<void> {
    await db.transaction("rw", table, db.actorRef, async () => {
      const existing = await table.get(assignmentId);
      if (!existing) {
        throw new MutableOperationalStateRuleViolationError(`SurveyAssignment "${assignmentId}" was not found.`);
      }
      if (existing.status !== "OPEN") {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignmentId}": reassignment is only allowed while status is OPEN ` +
            `(current: "${existing.status}").`,
        );
      }
      if (entry.fromOperator !== existing.assignedOperator) {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignmentId}": fromOperator "${entry.fromOperator}" does not equal the ` +
            `current assignedOperator "${existing.assignedOperator}".`,
        );
      }

      await assertActorType(db.actorRef, entry.toOperator, ["HUMAN_OPERATOR"]);
      await assertActorType(db.actorRef, entry.changedBy, ["HUMAN_OPERATOR"]);

      const historyEntry: ReassignmentHistoryEntry = {
        fromOperator: entry.fromOperator,
        toOperator: entry.toOperator,
        changedBy: entry.changedBy,
        changedAt: entry.changedAt,
      };

      await table.update(assignmentId, {
        assignedOperator: entry.toOperator,
        reassignmentHistory: [...existing.reassignmentHistory, historyEntry],
      });
    });
  },

  /**
   * Closure (HD-01A): the one-way OPEN -> CLOSED terminal transition.
   * closedBy must resolve to an ACTIVE HUMAN_OPERATOR; closedBy and
   * closedAt are written once, together, atomically — never inferred
   * from assignedOperator, never recorded in reassignmentHistory. No
   * repository method can ever revisit a CLOSED row's closedBy/closedAt
   * — every mutation method (including this one) rejects outright once
   * status is no longer OPEN, so both fields are immutable by
   * construction, not by an extra check.
   */
  async close(assignmentId: AssignmentId, fields: { closedBy: ActorId; closedAt: string }): Promise<void> {
    await db.transaction("rw", table, db.actorRef, async () => {
      const existing = await table.get(assignmentId);
      if (!existing) {
        throw new MutableOperationalStateRuleViolationError(`SurveyAssignment "${assignmentId}" was not found.`);
      }
      if (existing.status !== "OPEN") {
        throw new MutableOperationalStateRuleViolationError(
          `SurveyAssignment "${assignmentId}" is already CLOSED — this is a terminal, one-way transition ` +
            `with no reopen in MVP (HD-01).`,
        );
      }

      await assertActorType(db.actorRef, fields.closedBy, ["HUMAN_OPERATOR"]);

      await table.update(assignmentId, {
        status: "CLOSED",
        closedBy: fields.closedBy,
        closedAt: fields.closedAt,
      });
    });
  },
};
