/**
 * G1-05C-01 — SurveyAssignment repository: create / reassign / close.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { surveyAssignmentRepository } from "../persistence/repositories/surveyAssignmentRepository.ts";
import { buildingRepository } from "../persistence/repositories/buildingRepository.ts";
import { actorRefRepository } from "../persistence/repositories/actorRefRepository.ts";
import type { SurveyAssignment } from "../domain/types/SurveyAssignment.ts";
import {
  ActorInactiveError,
  ActorNotFoundError,
  ActorTypeViolationError,
  MutableOperationalStateRuleViolationError,
} from "../persistence/guards/errors.ts";
import { nextId } from "./testIds.ts";

async function makeBuilding(): Promise<string> {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "Test Building" });
  return buildingId;
}

async function makeHuman(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "H", status: "ACTIVE" });
  return actorId;
}

async function makeAgent(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "AGENT", displayName: "Guide", status: "ACTIVE" });
  return actorId;
}

async function makeInactiveHuman(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "Inactive", status: "INACTIVE" });
  return actorId;
}

function makeAssignmentInput(
  buildingId: string,
  assignedOperator: string,
  overrides: Partial<SurveyAssignment> = {},
): SurveyAssignment {
  return {
    assignmentId: nextId("assignment"),
    buildingId,
    assignedOperator,
    status: "OPEN",
    reassignmentHistory: [],
    ...overrides,
  };
}

async function makeOpenAssignment(): Promise<{ assignmentId: string; buildingId: string; operator: string }> {
  const buildingId = await makeBuilding();
  const operator = await makeHuman();
  const input = makeAssignmentInput(buildingId, operator);
  await surveyAssignmentRepository.create(input);
  return { assignmentId: input.assignmentId, buildingId, operator };
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

test("SurveyAssignment: create succeeds with status OPEN", async () => {
  const buildingId = await makeBuilding();
  const operator = await makeHuman();
  const input = makeAssignmentInput(buildingId, operator);
  await surveyAssignmentRepository.create(input);

  const found = await surveyAssignmentRepository.getById(input.assignmentId);
  assert.equal(found?.status, "OPEN");
  assert.equal(found?.buildingId, buildingId);
  assert.equal(found?.assignedOperator, operator);
  assert.deepEqual(found?.reassignmentHistory, []);
  assert.equal(found?.closedBy, undefined);
  assert.equal(found?.closedAt, undefined);
});

test("SurveyAssignment: create rejects a nonexistent buildingId", async () => {
  const operator = await makeHuman();
  const input = makeAssignmentInput(nextId("nonexistent-building"), operator);
  await assert.rejects(() => surveyAssignmentRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("SurveyAssignment: create rejects an unknown assignedOperator", async () => {
  const buildingId = await makeBuilding();
  const input = makeAssignmentInput(buildingId, nextId("actor"));
  await assert.rejects(() => surveyAssignmentRepository.create(input), ActorNotFoundError);
});

test("SurveyAssignment: create rejects an AGENT assignedOperator", async () => {
  const buildingId = await makeBuilding();
  const agent = await makeAgent();
  const input = makeAssignmentInput(buildingId, agent);
  await assert.rejects(() => surveyAssignmentRepository.create(input), ActorTypeViolationError);
});

test("SurveyAssignment: create rejects an INACTIVE assignedOperator", async () => {
  const buildingId = await makeBuilding();
  const inactive = await makeInactiveHuman();
  const input = makeAssignmentInput(buildingId, inactive);
  await assert.rejects(() => surveyAssignmentRepository.create(input), ActorInactiveError);
});

// ---------------------------------------------------------------------------
// reassign()
// ---------------------------------------------------------------------------

test("SurveyAssignment: reassign succeeds while OPEN", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const newOperator = await makeHuman();
  const changedBy = await makeHuman();
  const changedAt = new Date().toISOString();

  await surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: newOperator, changedBy, changedAt });

  const found = await surveyAssignmentRepository.getById(assignmentId);
  assert.equal(found?.assignedOperator, newOperator);
  assert.equal(found?.reassignmentHistory.length, 1);
  assert.deepEqual(found?.reassignmentHistory[0], { fromOperator: operator, toOperator: newOperator, changedBy, changedAt });
});

test("SurveyAssignment: reassign rejects a fromOperator mismatch", async () => {
  const { assignmentId } = await makeOpenAssignment();
  const newOperator = await makeHuman();
  const changedBy = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, {
        fromOperator: nextId("actor"), // does not equal the real current assignedOperator
        toOperator: newOperator,
        changedBy,
        changedAt: new Date().toISOString(),
      }),
    MutableOperationalStateRuleViolationError,
  );
});

test("SurveyAssignment: reassign rejects an unknown toOperator", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const changedBy = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, {
        fromOperator: operator,
        toOperator: nextId("actor"),
        changedBy,
        changedAt: new Date().toISOString(),
      }),
    ActorNotFoundError,
  );
});

test("SurveyAssignment: reassign rejects an AGENT toOperator", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const agent = await makeAgent();
  const changedBy = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: agent, changedBy, changedAt: new Date().toISOString() }),
    ActorTypeViolationError,
  );
});

test("SurveyAssignment: reassign rejects an INACTIVE toOperator", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const inactive = await makeInactiveHuman();
  const changedBy = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: inactive, changedBy, changedAt: new Date().toISOString() }),
    ActorInactiveError,
  );
});

test("SurveyAssignment: reassign rejects an unknown changedBy", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const newOperator = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, {
        fromOperator: operator,
        toOperator: newOperator,
        changedBy: nextId("actor"),
        changedAt: new Date().toISOString(),
      }),
    ActorNotFoundError,
  );
});

test("SurveyAssignment: reassign rejects an AGENT changedBy", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const newOperator = await makeHuman();
  const agent = await makeAgent();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: newOperator, changedBy: agent, changedAt: new Date().toISOString() }),
    ActorTypeViolationError,
  );
});

test("SurveyAssignment: reassign rejects an INACTIVE changedBy", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const newOperator = await makeHuman();
  const inactive = await makeInactiveHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: newOperator, changedBy: inactive, changedAt: new Date().toISOString() }),
    ActorInactiveError,
  );
});

test("SurveyAssignment: reassignmentHistory appends correctly across multiple reassignments, prior entries stay unchanged, and assignedOperator tracks the latest toOperator", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const secondOperator = await makeHuman();
  const thirdOperator = await makeHuman();
  const changedBy1 = await makeHuman();
  const changedBy2 = await makeHuman();
  const changedAt1 = new Date(2024, 0, 1).toISOString();
  const changedAt2 = new Date(2024, 0, 2).toISOString();

  await surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: secondOperator, changedBy: changedBy1, changedAt: changedAt1 });
  const afterFirst = await surveyAssignmentRepository.getById(assignmentId);
  assert.equal(afterFirst?.reassignmentHistory.length, 1);
  assert.equal(afterFirst?.assignedOperator, secondOperator);

  await surveyAssignmentRepository.reassign(assignmentId, { fromOperator: secondOperator, toOperator: thirdOperator, changedBy: changedBy2, changedAt: changedAt2 });
  const afterSecond = await surveyAssignmentRepository.getById(assignmentId);

  assert.equal(afterSecond?.reassignmentHistory.length, 2);
  assert.deepEqual(afterSecond?.reassignmentHistory[0], { fromOperator: operator, toOperator: secondOperator, changedBy: changedBy1, changedAt: changedAt1 }, "first entry must remain exactly as originally written");
  assert.deepEqual(afterSecond?.reassignmentHistory[1], { fromOperator: secondOperator, toOperator: thirdOperator, changedBy: changedBy2, changedAt: changedAt2 });
  assert.equal(afterSecond?.assignedOperator, thirdOperator, "assignedOperator must equal the latest history entry's toOperator");
});

test("SurveyAssignment: reassign rejects a nonexistent assignmentId", async () => {
  const operator = await makeHuman();
  const newOperator = await makeHuman();
  const changedBy = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(nextId("assignment"), {
        fromOperator: operator,
        toOperator: newOperator,
        changedBy,
        changedAt: new Date().toISOString(),
      }),
    MutableOperationalStateRuleViolationError,
  );
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

test("SurveyAssignment: close rejects a nonexistent assignmentId", async () => {
  const closer = await makeHuman();
  await assert.rejects(
    () => surveyAssignmentRepository.close(nextId("assignment"), { closedBy: closer, closedAt: new Date().toISOString() }),
    MutableOperationalStateRuleViolationError,
  );
});

test("SurveyAssignment: close succeeds with a valid closedBy + closedAt", async () => {
  const { assignmentId } = await makeOpenAssignment();
  const closer = await makeHuman();
  const closedAt = new Date().toISOString();

  await surveyAssignmentRepository.close(assignmentId, { closedBy: closer, closedAt });

  const found = await surveyAssignmentRepository.getById(assignmentId);
  assert.equal(found?.status, "CLOSED");
  assert.equal(found?.closedBy, closer);
  assert.equal(found?.closedAt, closedAt);
});

test("SurveyAssignment: close rejects an unknown closedBy", async () => {
  const { assignmentId } = await makeOpenAssignment();
  await assert.rejects(
    () => surveyAssignmentRepository.close(assignmentId, { closedBy: nextId("actor"), closedAt: new Date().toISOString() }),
    ActorNotFoundError,
  );
});

test("SurveyAssignment: close rejects an AGENT closedBy", async () => {
  const { assignmentId } = await makeOpenAssignment();
  const agent = await makeAgent();
  await assert.rejects(
    () => surveyAssignmentRepository.close(assignmentId, { closedBy: agent, closedAt: new Date().toISOString() }),
    ActorTypeViolationError,
  );
});

test("SurveyAssignment: close rejects an INACTIVE closedBy", async () => {
  const { assignmentId } = await makeOpenAssignment();
  const inactive = await makeInactiveHuman();
  await assert.rejects(
    () => surveyAssignmentRepository.close(assignmentId, { closedBy: inactive, closedAt: new Date().toISOString() }),
    ActorInactiveError,
  );
});

test("SurveyAssignment: repeat close is rejected, and closedBy/closedAt remain immutable", async () => {
  const { assignmentId } = await makeOpenAssignment();
  const closer = await makeHuman();
  const closedAt = new Date().toISOString();
  await surveyAssignmentRepository.close(assignmentId, { closedBy: closer, closedAt });

  const otherCloser = await makeHuman();
  await assert.rejects(
    () => surveyAssignmentRepository.close(assignmentId, { closedBy: otherCloser, closedAt: new Date().toISOString() }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await surveyAssignmentRepository.getById(assignmentId);
  assert.equal(found?.closedBy, closer, "closedBy must remain the original value — immutable after closure");
  assert.equal(found?.closedAt, closedAt, "closedAt must remain the original value — immutable after closure");
});

test("SurveyAssignment: reassignment after CLOSED is rejected (CLOSED -> OPEN is never implied by reassign either)", async () => {
  const { assignmentId, operator } = await makeOpenAssignment();
  const closer = await makeHuman();
  await surveyAssignmentRepository.close(assignmentId, { closedBy: closer, closedAt: new Date().toISOString() });

  const newOperator = await makeHuman();
  await assert.rejects(
    () =>
      surveyAssignmentRepository.reassign(assignmentId, { fromOperator: operator, toOperator: newOperator, changedBy: closer, changedAt: new Date().toISOString() }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await surveyAssignmentRepository.getById(assignmentId);
  assert.equal(found?.status, "CLOSED", "status must remain CLOSED — no implicit reopen");
});

// ---------------------------------------------------------------------------
// Malformed-state prevention (enforced at create() — no unsafe API needed)
// ---------------------------------------------------------------------------

test("SurveyAssignment: create rejects status CLOSED at creation", async () => {
  const buildingId = await makeBuilding();
  const operator = await makeHuman();
  const input = makeAssignmentInput(buildingId, operator, { status: "CLOSED" });
  await assert.rejects(() => surveyAssignmentRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("SurveyAssignment: create rejects closedBy/closedAt present at creation even with status OPEN", async () => {
  const buildingId = await makeBuilding();
  const operator = await makeHuman();
  const closer = await makeHuman();
  const input = makeAssignmentInput(buildingId, operator, { closedBy: closer, closedAt: new Date().toISOString() });
  await assert.rejects(() => surveyAssignmentRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("SurveyAssignment: create rejects a non-empty reassignmentHistory at creation", async () => {
  const buildingId = await makeBuilding();
  const operator = await makeHuman();
  const input = makeAssignmentInput(buildingId, operator, {
    reassignmentHistory: [{ fromOperator: operator, toOperator: operator, changedBy: operator, changedAt: new Date().toISOString() }],
  });
  await assert.rejects(() => surveyAssignmentRepository.create(input), MutableOperationalStateRuleViolationError);
});
