/**
 * G1-05C-02 — ScopeItem repository: create / complete / skip.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { scopeItemRepository } from "../persistence/repositories/scopeItemRepository.ts";
import { surveyAssignmentRepository } from "../persistence/repositories/surveyAssignmentRepository.ts";
import { spatialTargetRepository } from "../persistence/repositories/spatialTargetRepository.ts";
import { buildingRepository } from "../persistence/repositories/buildingRepository.ts";
import { actorRefRepository } from "../persistence/repositories/actorRefRepository.ts";
import type { ScopeItem } from "../domain/types/ScopeItem.ts";
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

function makeScopeItemInput(
  assignmentId: string,
  targetId: string,
  overrides: Partial<ScopeItem> = {},
): ScopeItem {
  return {
    scopeItemId: nextId("scopeItem"),
    assignmentId,
    targetId,
    requiredMeasurementTypes: ["AREA"],
    status: "PENDING",
    ...overrides,
  };
}

async function makePendingScopeItem(): Promise<{ scopeItemId: string; assignmentId: string; targetId: string }> {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId);
  await scopeItemRepository.create(input);
  return { scopeItemId: input.scopeItemId, assignmentId, targetId };
}

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

test("ScopeItem: create succeeds with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId);
  await scopeItemRepository.create(input);

  const found = await scopeItemRepository.getById(input.scopeItemId);
  assert.equal(found?.status, "PENDING");
  assert.equal(found?.assignmentId, assignmentId);
  assert.equal(found?.targetId, targetId);
  assert.deepEqual(found?.requiredMeasurementTypes, ["AREA"]);
  assert.equal(found?.fulfillingSessionId, undefined);
  assert.equal(found?.completedBy, undefined);
  assert.equal(found?.completedAt, undefined);
  assert.equal(found?.skippedBy, undefined);
  assert.equal(found?.skippedAt, undefined);
  assert.equal(found?.skipReason, undefined);
});

test("ScopeItem: create rejects a nonexistent assignmentId", async () => {
  const targetId = await makeTarget();
  const input = makeScopeItemInput(nextId("nonexistent-assignment"), targetId);
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects a nonexistent targetId", async () => {
  const assignmentId = await makeAssignment();
  const input = makeScopeItemInput(assignmentId, nextId("nonexistent-target"));
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects status DONE at creation", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId, { status: "DONE" });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects status SKIPPED at creation", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId, { status: "SKIPPED" });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects fulfillingSessionId present at creation even with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId, { fulfillingSessionId: nextId("session") });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects completedBy present at creation even with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const completedBy = await makeHuman();
  const input = makeScopeItemInput(assignmentId, targetId, { completedBy });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects completedAt present at creation even with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId, { completedAt: new Date().toISOString() });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects skippedBy present at creation even with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const skippedBy = await makeHuman();
  const input = makeScopeItemInput(assignmentId, targetId, { skippedBy });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects skippedAt present at creation even with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId, { skippedAt: new Date().toISOString() });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

test("ScopeItem: create rejects skipReason present at creation even with status PENDING", async () => {
  const assignmentId = await makeAssignment();
  const targetId = await makeTarget();
  const input = makeScopeItemInput(assignmentId, targetId, { skipReason: "premature reason" });
  await assert.rejects(() => scopeItemRepository.create(input), MutableOperationalStateRuleViolationError);
});

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------

test("ScopeItem: complete succeeds and leaves skip fields absent", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const completedBy = await makeHuman();
  const completedAt = new Date().toISOString();
  const fulfillingSessionId = nextId("session");

  await scopeItemRepository.complete(scopeItemId, { completedBy, completedAt, fulfillingSessionId });

  const found = await scopeItemRepository.getById(scopeItemId);
  assert.equal(found?.status, "DONE");
  assert.equal(found?.completedBy, completedBy);
  assert.equal(found?.completedAt, completedAt);
  assert.equal(found?.fulfillingSessionId, fulfillingSessionId);
  assert.equal(found?.skippedBy, undefined);
  assert.equal(found?.skippedAt, undefined);
  assert.equal(found?.skipReason, undefined);
});

test("ScopeItem: complete rejects a nonexistent scopeItemId", async () => {
  const completedBy = await makeHuman();
  await assert.rejects(
    () =>
      scopeItemRepository.complete(nextId("scopeItem"), {
        completedBy,
        completedAt: new Date().toISOString(),
        fulfillingSessionId: nextId("session"),
      }),
    MutableOperationalStateRuleViolationError,
  );
});

test("ScopeItem: complete rejects an unknown completedBy", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  await assert.rejects(
    () =>
      scopeItemRepository.complete(scopeItemId, {
        completedBy: nextId("actor"),
        completedAt: new Date().toISOString(),
        fulfillingSessionId: nextId("session"),
      }),
    ActorNotFoundError,
  );
});

test("ScopeItem: complete rejects an AGENT completedBy", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const agent = await makeAgent();
  await assert.rejects(
    () =>
      scopeItemRepository.complete(scopeItemId, {
        completedBy: agent,
        completedAt: new Date().toISOString(),
        fulfillingSessionId: nextId("session"),
      }),
    ActorTypeViolationError,
  );
});

test("ScopeItem: complete rejects an INACTIVE completedBy", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const inactive = await makeInactiveHuman();
  await assert.rejects(
    () =>
      scopeItemRepository.complete(scopeItemId, {
        completedBy: inactive,
        completedAt: new Date().toISOString(),
        fulfillingSessionId: nextId("session"),
      }),
    ActorInactiveError,
  );
});

test("ScopeItem: repeat complete is rejected, and completion attribution remains immutable", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const completedBy = await makeHuman();
  const completedAt = new Date().toISOString();
  const fulfillingSessionId = nextId("session");
  await scopeItemRepository.complete(scopeItemId, { completedBy, completedAt, fulfillingSessionId });

  const otherCompletedBy = await makeHuman();
  await assert.rejects(
    () =>
      scopeItemRepository.complete(scopeItemId, {
        completedBy: otherCompletedBy,
        completedAt: new Date().toISOString(),
        fulfillingSessionId: nextId("session"),
      }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await scopeItemRepository.getById(scopeItemId);
  assert.equal(found?.completedBy, completedBy, "completedBy must remain the original value — immutable after completion");
  assert.equal(found?.fulfillingSessionId, fulfillingSessionId, "fulfillingSessionId must remain the original value");
});

test("ScopeItem: complete after SKIPPED is rejected (no SKIPPED -> DONE)", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const skippedBy = await makeHuman();
  await scopeItemRepository.skip(scopeItemId, { skippedBy, skippedAt: new Date().toISOString(), skipReason: "not needed" });

  const completedBy = await makeHuman();
  await assert.rejects(
    () =>
      scopeItemRepository.complete(scopeItemId, {
        completedBy,
        completedAt: new Date().toISOString(),
        fulfillingSessionId: nextId("session"),
      }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await scopeItemRepository.getById(scopeItemId);
  assert.equal(found?.status, "SKIPPED", "status must remain SKIPPED — no cross-terminal transition");
});

// ---------------------------------------------------------------------------
// skip()
// ---------------------------------------------------------------------------

test("ScopeItem: skip succeeds and leaves completion fields absent", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const skippedBy = await makeHuman();
  const skippedAt = new Date().toISOString();
  const skipReason = "target inaccessible";

  await scopeItemRepository.skip(scopeItemId, { skippedBy, skippedAt, skipReason });

  const found = await scopeItemRepository.getById(scopeItemId);
  assert.equal(found?.status, "SKIPPED");
  assert.equal(found?.skippedBy, skippedBy);
  assert.equal(found?.skippedAt, skippedAt);
  assert.equal(found?.skipReason, skipReason);
  assert.equal(found?.fulfillingSessionId, undefined, "fulfillingSessionId must remain absent when SKIPPED");
  assert.equal(found?.completedBy, undefined);
  assert.equal(found?.completedAt, undefined);
});

test("ScopeItem: skip rejects a nonexistent scopeItemId", async () => {
  const skippedBy = await makeHuman();
  await assert.rejects(
    () => scopeItemRepository.skip(nextId("scopeItem"), { skippedBy, skippedAt: new Date().toISOString(), skipReason: "n/a" }),
    MutableOperationalStateRuleViolationError,
  );
});

test("ScopeItem: skip rejects an unknown skippedBy", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  await assert.rejects(
    () => scopeItemRepository.skip(scopeItemId, { skippedBy: nextId("actor"), skippedAt: new Date().toISOString(), skipReason: "n/a" }),
    ActorNotFoundError,
  );
});

test("ScopeItem: skip rejects an AGENT skippedBy", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const agent = await makeAgent();
  await assert.rejects(
    () => scopeItemRepository.skip(scopeItemId, { skippedBy: agent, skippedAt: new Date().toISOString(), skipReason: "n/a" }),
    ActorTypeViolationError,
  );
});

test("ScopeItem: skip rejects an INACTIVE skippedBy", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const inactive = await makeInactiveHuman();
  await assert.rejects(
    () => scopeItemRepository.skip(scopeItemId, { skippedBy: inactive, skippedAt: new Date().toISOString(), skipReason: "n/a" }),
    ActorInactiveError,
  );
});

test("ScopeItem: repeat skip is rejected, and skip attribution remains immutable", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const skippedBy = await makeHuman();
  const skippedAt = new Date().toISOString();
  const skipReason = "original reason";
  await scopeItemRepository.skip(scopeItemId, { skippedBy, skippedAt, skipReason });

  const otherSkippedBy = await makeHuman();
  await assert.rejects(
    () => scopeItemRepository.skip(scopeItemId, { skippedBy: otherSkippedBy, skippedAt: new Date().toISOString(), skipReason: "different reason" }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await scopeItemRepository.getById(scopeItemId);
  assert.equal(found?.skippedBy, skippedBy, "skippedBy must remain the original value — immutable after skip");
  assert.equal(found?.skipReason, skipReason, "skipReason must remain the original value");
});

test("ScopeItem: skip after DONE is rejected (no DONE -> SKIPPED)", async () => {
  const { scopeItemId } = await makePendingScopeItem();
  const completedBy = await makeHuman();
  await scopeItemRepository.complete(scopeItemId, {
    completedBy,
    completedAt: new Date().toISOString(),
    fulfillingSessionId: nextId("session"),
  });

  const skippedBy = await makeHuman();
  await assert.rejects(
    () => scopeItemRepository.skip(scopeItemId, { skippedBy, skippedAt: new Date().toISOString(), skipReason: "n/a" }),
    MutableOperationalStateRuleViolationError,
  );

  const found = await scopeItemRepository.getById(scopeItemId);
  assert.equal(found?.status, "DONE", "status must remain DONE — no cross-terminal transition");
});
