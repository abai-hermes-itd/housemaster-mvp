/**
 * G1-05C-03 — MeasurementSession repository: create / close.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { measurementSessionRepository } from "../persistence/repositories/measurementSessionRepository.ts";
import { scopeItemRepository } from "../persistence/repositories/scopeItemRepository.ts";
import { surveyAssignmentRepository } from "../persistence/repositories/surveyAssignmentRepository.ts";
import { spatialTargetRepository } from "../persistence/repositories/spatialTargetRepository.ts";
import { buildingRepository } from "../persistence/repositories/buildingRepository.ts";
import { actorRefRepository } from "../persistence/repositories/actorRefRepository.ts";
import type { MeasurementSession } from "../domain/types/MeasurementSession.ts";
import {
  ActorInactiveError,
  ActorNotFoundError,
  ActorTypeViolationError,
  MutableOperationalStateRuleViolationError,
} from "../persistence/guards/errors.ts";
import { nextId } from "./testIds.ts";

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

async function makeTarget(): Promise<string> {
  const targetId = nextId("target");
  await spatialTargetRepository.create({
    targetId,
    buildingId: nextId("building"),
    targetType: "ROOM",
    replacesTargetIds: [],
    status: "ACTIVE",
  });
  return targetId;
}

async function makeAssignment(): Promise<string> {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "Test Building" });
  const operator = await makeHuman();
  const assignmentId = nextId("assignment");
  await surveyAssignmentRepository.create({
    assignmentId,
    buildingId,
    assignedOperator: operator,
    status: "OPEN",
    reassignmentHistory: [],
  });
  return assignmentId;
}

/** Returns a real ScopeItem's id plus its own targetId. */
async function makeScopeItem(): Promise<{ scopeItemId: string; targetId: string }> {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const scopeItemId = nextId("scopeItem");
  await scopeItemRepository.create({
    scopeItemId,
    assignmentId,
    targetId,
    requiredMeasurementTypes: ["AREA"],
    status: "PENDING",
  });
  return { scopeItemId, targetId };
}

function makeSessionInput(
  scopeItemId: string,
  targetId: string,
  openedBy: string,
  overrides: Partial<MeasurementSession> = {},
): MeasurementSession {
  return {
    sessionId: nextId("session"),
    targetId,
    scopeItemId,
    openedBy,
    status: "OPEN",
    ...overrides,
  };
}

async function makeOpenSession(): Promise<{ sessionId: string; scopeItemId: string; targetId: string; openedBy: string }> {
  const { scopeItemId, targetId } = await makeScopeItem();
  const openedBy = await makeHuman();
  const input = makeSessionInput(scopeItemId, targetId, openedBy);
  await measurementSessionRepository.create(input);
  return { sessionId: input.sessionId, scopeItemId, targetId, openedBy };
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

test("MeasurementSession: create succeeds with status OPEN", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const openedBy = await makeHuman();
  const input = makeSessionInput(scopeItemId, targetId, openedBy);
  await measurementSessionRepository.create(input);

  const found = await measurementSessionRepository.getById(input.sessionId);
  assert.equal(found?.status, "OPEN");
  assert.equal(found?.scopeItemId, scopeItemId);
  assert.equal(found?.targetId, targetId);
  assert.equal(found?.openedBy, openedBy);
  assert.equal(found?.closedBy, undefined);
  assert.equal(found?.closedAt, undefined);
});

test("MeasurementSession: create rejects a nonexistent scopeItemId", async () => {
  const targetId = await makeTarget();
  const openedBy = await makeHuman();
  const input = makeSessionInput(nextId("nonexistent-scopeItem"), targetId, openedBy);
  await assert.rejects(() => measurementSessionRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("MeasurementSession: create rejects a nonexistent targetId", async () => {
  const { scopeItemId } = await makeScopeItem();
  const openedBy = await makeHuman();
  const input = makeSessionInput(scopeItemId, nextId("nonexistent-target"), openedBy);
  await assert.rejects(() => measurementSessionRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("MeasurementSession: create rejects targetId not equal to parent ScopeItem.targetId", async () => {
  const { scopeItemId } = await makeScopeItem();
  const wrongTarget = await makeTarget(); // a real, different target
  const openedBy = await makeHuman();
  const input = makeSessionInput(scopeItemId, wrongTarget, openedBy);
  await assert.rejects(() => measurementSessionRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("MeasurementSession: create rejects an unknown openedBy", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const input = makeSessionInput(scopeItemId, targetId, nextId("actor"));
  await assert.rejects(() => measurementSessionRepository.create(input), ActorNotFoundError);
});

test("MeasurementSession: create rejects an INACTIVE openedBy", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const inactive = await makeInactiveHuman();
  const input = makeSessionInput(scopeItemId, targetId, inactive);
  await assert.rejects(() => measurementSessionRepository.create(input), ActorInactiveError);
});

test("MeasurementSession: create rejects an AGENT openedBy", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const agent = await makeAgent();
  const input = makeSessionInput(scopeItemId, targetId, agent);
  await assert.rejects(() => measurementSessionRepository.create(input), ActorTypeViolationError);
});

test("MeasurementSession: create rejects status CLOSED at creation", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const openedBy = await makeHuman();
  const input = makeSessionInput(scopeItemId, targetId, openedBy, { status: "CLOSED" });
  await assert.rejects(() => measurementSessionRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("MeasurementSession: create rejects closedBy present at creation even with status OPEN", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const openedBy = await makeHuman();
  const closer = await makeHuman();
  const input = makeSessionInput(scopeItemId, targetId, openedBy, { closedBy: closer });
  await assert.rejects(() => measurementSessionRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("MeasurementSession: create rejects closedAt present at creation even with status OPEN", async () => {
  const { scopeItemId, targetId } = await makeScopeItem();
  const openedBy = await makeHuman();
  const input = makeSessionInput(scopeItemId, targetId, openedBy, { closedAt: new Date().toISOString() });
  await assert.rejects(() => measurementSessionRepository.create(input), MutableOperationalStateRuleViolationError);
});

// ---------------------------------------------------------------------------
// getById()
// ---------------------------------------------------------------------------

test("MeasurementSession: getById returns the created session", async () => {
  const { sessionId, scopeItemId, targetId, openedBy } = await makeOpenSession();
  const found = await measurementSessionRepository.getById(sessionId);
  assert.equal(found?.sessionId, sessionId);
  assert.equal(found?.scopeItemId, scopeItemId);
  assert.equal(found?.targetId, targetId);
  assert.equal(found?.openedBy, openedBy);
});

test("MeasurementSession: getById on a nonexistent id returns undefined", async () => {
  const found = await measurementSessionRepository.getById(nextId("session"));
  assert.equal(found, undefined);
});

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

test("MeasurementSession: close succeeds and leaves openedBy/targetId/scopeItemId unchanged", async () => {
  const { sessionId, scopeItemId, targetId, openedBy } = await makeOpenSession();
  const closer = await makeHuman();
  const closedAt = new Date().toISOString();

  await measurementSessionRepository.close(sessionId, { closedBy: closer, closedAt });

  const found = await measurementSessionRepository.getById(sessionId);
  assert.equal(found?.status, "CLOSED");
  assert.equal(found?.closedBy, closer);
  assert.equal(found?.closedAt, closedAt);
  assert.equal(found?.openedBy, openedBy, "openedBy must remain unchanged after close");
  assert.equal(found?.targetId, targetId, "targetId must remain unchanged after close");
  assert.equal(found?.scopeItemId, scopeItemId, "scopeItemId must remain unchanged after close");
});

test("MeasurementSession: close rejects an unknown closedBy", async () => {
  const { sessionId } = await makeOpenSession();
  await assert.rejects(
    () => measurementSessionRepository.close(sessionId, { closedBy: nextId("actor"), closedAt: new Date().toISOString() }),
    ActorNotFoundError,
  );
});

test("MeasurementSession: close rejects an INACTIVE closedBy", async () => {
  const { sessionId } = await makeOpenSession();
  const inactive = await makeInactiveHuman();
  await assert.rejects(
    () => measurementSessionRepository.close(sessionId, { closedBy: inactive, closedAt: new Date().toISOString() }),
    ActorInactiveError,
  );
});

test("MeasurementSession: close rejects an AGENT closedBy", async () => {
  const { sessionId } = await makeOpenSession();
  const agent = await makeAgent();
  await assert.rejects(
    () => measurementSessionRepository.close(sessionId, { closedBy: agent, closedAt: new Date().toISOString() }),
    ActorTypeViolationError,
  );
});

test("MeasurementSession: close rejects a nonexistent sessionId", async () => {
  const closer = await makeHuman();
  await assert.rejects(
    () => measurementSessionRepository.close(nextId("session"), { closedBy: closer, closedAt: new Date().toISOString() }),
    MutableOperationalStateRuleViolationError,
  );
});

test("MeasurementSession: repeat close is rejected, and closedBy/closedAt remain immutable (no reopen)", async () => {
  const { sessionId } = await makeOpenSession();
  const closer = await makeHuman();
  const closedAt = new Date().toISOString();
  await measurementSessionRepository.close(sessionId, { closedBy: closer, closedAt });

  const otherCloser = await makeHuman();
  await assert.rejects(
    () => measurementSessionRepository.close(sessionId, { closedBy: otherCloser, closedAt: new Date().toISOString() }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await measurementSessionRepository.getById(sessionId);
  assert.equal(found?.status, "CLOSED", "status must remain CLOSED — no implicit reopen");
  assert.equal(found?.closedBy, closer, "closedBy must remain the original value — immutable after closure");
  assert.equal(found?.closedAt, closedAt, "closedAt must remain the original value — immutable after closure");
});

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

test("MeasurementSession: repository exposes exactly create/getById/close — no generic update()", () => {
  assert.deepEqual(Object.keys(measurementSessionRepository).sort(), ["close", "create", "getById"]);
});
