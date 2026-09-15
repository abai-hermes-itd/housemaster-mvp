import test from "node:test";
import assert from "node:assert/strict";
import { actorRefRepository } from "../persistence/repositories/actorRefRepository.ts";
import { calibrationSessionRepository } from "../persistence/repositories/calibrationSessionRepository.ts";
import { measurementRepository } from "../persistence/repositories/measurementRepository.ts";
import { evidenceRepository } from "../persistence/repositories/evidenceRepository.ts";
import { proposalRepository } from "../persistence/repositories/proposalRepository.ts";
import { decisionRepository } from "../persistence/repositories/decisionRepository.ts";
import { knowledgeCitationRepository } from "../persistence/repositories/knowledgeCitationRepository.ts";
import { AppendOnlyViolationError, ActorTypeViolationError, ReferenceIdentityRuleViolationError } from "../persistence/guards/errors.ts";
import { db } from "../persistence/db.ts";
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

async function makeAcceptedDecision(): Promise<string> {
  const humanId = await makeHuman();
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });
  const decisionId = nextId("decision");
  await decisionRepository.create({
    decisionId,
    proposalId,
    actorId: humanId,
    outcome: "ACCEPTED",
    createdAt: new Date().toISOString(),
  });
  return decisionId;
}

// ---------------------------------------------------------------------------
// CalibrationSession
// ---------------------------------------------------------------------------

test("CalibrationSession: create succeeds, read succeeds", async () => {
  const actorId = await makeHuman();
  const calibrationSessionId = nextId("calibration");
  await calibrationSessionRepository.create({
    calibrationSessionId,
    deviceRef: "device-1",
    calibratedAt: new Date().toISOString(),
    referenceMethod: "checkerboard",
    actorId,
    validUntilAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  const found = await calibrationSessionRepository.getById(calibrationSessionId);
  assert.equal(found?.calibrationSessionId, calibrationSessionId);
});

test("CalibrationSession: repository update rejects, repository delete rejects", async () => {
  const actorId = await makeHuman();
  const calibrationSessionId = nextId("calibration");
  await calibrationSessionRepository.create({
    calibrationSessionId,
    deviceRef: "device-1",
    calibratedAt: new Date().toISOString(),
    referenceMethod: "checkerboard",
    actorId,
    validUntilAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  await assert.rejects(
    () => calibrationSessionRepository.update(calibrationSessionId, { deviceRef: "device-2" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => calibrationSessionRepository.delete(calibrationSessionId), AppendOnlyViolationError);
});

test("CalibrationSession: historical row cannot be mutated (data itself is unchanged after a rejected update attempt)", async () => {
  const actorId = await makeHuman();
  const calibrationSessionId = nextId("calibration");
  const originalValidUntilAt = new Date(Date.now() + 86_400_000).toISOString();
  await calibrationSessionRepository.create({
    calibrationSessionId,
    deviceRef: "device-1",
    calibratedAt: new Date().toISOString(),
    referenceMethod: "checkerboard",
    actorId,
    validUntilAt: originalValidUntilAt,
  });

  await assert.rejects(() =>
    calibrationSessionRepository.update(calibrationSessionId, { validUntilAt: new Date().toISOString() }),
  );

  const stillOriginal = await calibrationSessionRepository.getById(calibrationSessionId);
  assert.equal(stillOriginal?.validUntilAt, originalValidUntilAt);
});

test("CalibrationSession: successor creation does not mutate the predecessor row", async () => {
  const actorId = await makeHuman();
  const predecessorId = nextId("calibration");
  const predecessorValidUntilAt = new Date(Date.now() + 86_400_000).toISOString();
  await calibrationSessionRepository.create({
    calibrationSessionId: predecessorId,
    deviceRef: "device-1",
    calibratedAt: new Date().toISOString(),
    referenceMethod: "checkerboard",
    actorId,
    validUntilAt: predecessorValidUntilAt,
  });

  const successorId = nextId("calibration");
  await calibrationSessionRepository.create({
    calibrationSessionId: successorId,
    deviceRef: "device-1",
    calibratedAt: new Date().toISOString(),
    referenceMethod: "checkerboard-v2",
    actorId,
    validUntilAt: new Date(Date.now() + 172_800_000).toISOString(),
    supersedesCalibrationSessionId: predecessorId,
  });

  const predecessorAfter = await calibrationSessionRepository.getById(predecessorId);
  assert.equal(predecessorAfter?.validUntilAt, predecessorValidUntilAt);
  assert.equal(predecessorAfter?.referenceMethod, "checkerboard");
});

test("CalibrationSession: actor type restriction — AGENT is rejected", async () => {
  const agentId = await makeAgent();
  await assert.rejects(
    () =>
      calibrationSessionRepository.create({
        calibrationSessionId: nextId("calibration"),
        deviceRef: "device-1",
        calibratedAt: new Date().toISOString(),
        referenceMethod: "checkerboard",
        actorId: agentId,
        validUntilAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    ActorTypeViolationError,
  );
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

test("Measurement: create succeeds, read succeeds", async () => {
  const actorId = await makeHuman();
  const measurementId = nextId("measurement");
  await measurementRepository.create({
    measurementId,
    sessionId: nextId("session"),
    actorId,
    entryMethod: "MANUAL_ENTERED",
    value: 3.2,
    unit: "m",
    measurementType: "LENGTH",
    createdAt: new Date().toISOString(),
  });

  const found = await measurementRepository.getById(measurementId);
  assert.equal(found?.value, 3.2);
});

test("Measurement: repository update rejects, repository delete rejects", async () => {
  const actorId = await makeHuman();
  const measurementId = nextId("measurement");
  await measurementRepository.create({
    measurementId,
    sessionId: nextId("session"),
    actorId,
    entryMethod: "MANUAL_ENTERED",
    value: 3.2,
    unit: "m",
    measurementType: "LENGTH",
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(() => measurementRepository.update(measurementId, { value: 9.9 }), AppendOnlyViolationError);
  await assert.rejects(() => measurementRepository.delete(measurementId), AppendOnlyViolationError);
});

test("Measurement: actor type restriction — AGENT is rejected (never AGENT, even via an accepted Proposal)", async () => {
  const agentId = await makeAgent();
  await assert.rejects(
    () =>
      measurementRepository.create({
        measurementId: nextId("measurement"),
        sessionId: nextId("session"),
        actorId: agentId,
        entryMethod: "MANUAL_ENTERED",
        value: 1,
        unit: "m",
        measurementType: "LENGTH",
        createdAt: new Date().toISOString(),
      }),
    ActorTypeViolationError,
  );
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

test("Evidence: create succeeds, read succeeds", async () => {
  const actorId = await makeHuman();
  const evidenceId = nextId("evidence");
  await evidenceRepository.create({
    evidenceId,
    sessionId: nextId("session"),
    storageRef: "obj://bucket/original.jpg",
    sourceType: "PHOTO",
    integrityValue: "sha256:original",
    actorId,
    createdAt: new Date().toISOString(),
  });

  const found = await evidenceRepository.getById(evidenceId);
  assert.equal(found?.storageRef, "obj://bucket/original.jpg");
});

test("Evidence: repository update rejects, repository delete rejects", async () => {
  const actorId = await makeHuman();
  const evidenceId = nextId("evidence");
  await evidenceRepository.create({
    evidenceId,
    sessionId: nextId("session"),
    storageRef: "obj://bucket/original.jpg",
    sourceType: "PHOTO",
    integrityValue: "sha256:original",
    actorId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => evidenceRepository.update(evidenceId, { storageRef: "obj://bucket/swapped.jpg" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => evidenceRepository.delete(evidenceId), AppendOnlyViolationError);
});

test("Evidence: storageRef cannot be mutated after creation (data itself is unchanged)", async () => {
  const actorId = await makeHuman();
  const evidenceId = nextId("evidence");
  await evidenceRepository.create({
    evidenceId,
    sessionId: nextId("session"),
    storageRef: "obj://bucket/original.jpg",
    sourceType: "PHOTO",
    integrityValue: "sha256:original",
    actorId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(() => evidenceRepository.update(evidenceId, { storageRef: "obj://bucket/swapped.jpg" }));
  const stillOriginal = await evidenceRepository.getById(evidenceId);
  assert.equal(stillOriginal?.storageRef, "obj://bucket/original.jpg");
});

test("Evidence: integrityValue cannot be mutated after creation (data itself is unchanged)", async () => {
  const actorId = await makeHuman();
  const evidenceId = nextId("evidence");
  await evidenceRepository.create({
    evidenceId,
    sessionId: nextId("session"),
    storageRef: "obj://bucket/original.jpg",
    sourceType: "PHOTO",
    integrityValue: "sha256:original",
    actorId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(() => evidenceRepository.update(evidenceId, { integrityValue: "sha256:tampered" }));
  const stillOriginal = await evidenceRepository.getById(evidenceId);
  assert.equal(stillOriginal?.integrityValue, "sha256:original");
});

test("Evidence: acceptingDecisionId requires an existing, ACCEPTED Decision", async () => {
  const actorId = await makeHuman();

  await assert.rejects(
    () =>
      evidenceRepository.create({
        evidenceId: nextId("evidence"),
        sessionId: nextId("session"),
        storageRef: "obj://bucket/a.jpg",
        sourceType: "PHOTO",
        integrityValue: "sha256:a",
        actorId,
        acceptingDecisionId: nextId("nonexistent-decision"),
        createdAt: new Date().toISOString(),
      }),
    ReferenceIdentityRuleViolationError,
    "a non-existent Decision must be rejected",
  );

  // A REJECTED Decision exists, but must still not be usable as acceptingDecisionId.
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });
  const rejectedDecisionId = nextId("decision");
  await decisionRepository.create({
    decisionId: rejectedDecisionId,
    proposalId,
    actorId,
    outcome: "REJECTED",
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () =>
      evidenceRepository.create({
        evidenceId: nextId("evidence"),
        sessionId: nextId("session"),
        storageRef: "obj://bucket/b.jpg",
        sourceType: "PHOTO",
        integrityValue: "sha256:b",
        actorId,
        acceptingDecisionId: rejectedDecisionId,
        createdAt: new Date().toISOString(),
      }),
    ReferenceIdentityRuleViolationError,
    "a REJECTED Decision must be rejected",
  );

  // An ACCEPTED Decision is the only case that succeeds.
  const acceptedDecisionId = await makeAcceptedDecision();
  const evidenceId = nextId("evidence");
  await evidenceRepository.create({
    evidenceId,
    sessionId: nextId("session"),
    storageRef: "obj://bucket/c.jpg",
    sourceType: "PHOTO",
    integrityValue: "sha256:c",
    actorId,
    acceptingDecisionId: acceptedDecisionId,
    createdAt: new Date().toISOString(),
  });
  const found = await evidenceRepository.getById(evidenceId);
  assert.equal(found?.acceptingDecisionId, acceptedDecisionId);
});

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

test("Proposal: create succeeds, read succeeds (author may be HUMAN_OPERATOR or AGENT)", async () => {
  const humanId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: humanId, createdAt: new Date().toISOString() });
  const found = await proposalRepository.getById(proposalId);
  assert.equal(found?.authorActorId, humanId);

  const agentId = await makeAgent();
  const agentProposalId = nextId("proposal");
  await proposalRepository.create({
    proposalId: agentProposalId,
    authorActorId: agentId,
    createdAt: new Date().toISOString(),
  });
  const foundAgent = await proposalRepository.getById(agentProposalId);
  assert.equal(foundAgent?.authorActorId, agentId);
});

test("Proposal: repository update rejects, repository delete rejects", async () => {
  const humanId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: humanId, createdAt: new Date().toISOString() });

  await assert.rejects(
    () => proposalRepository.update(proposalId, { authorActorId: nextId("someone-else") }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => proposalRepository.delete(proposalId), AppendOnlyViolationError);
});

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

test("Decision: create succeeds, read succeeds", async () => {
  const humanId = await makeHuman();
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });

  const decisionId = nextId("decision");
  await decisionRepository.create({
    decisionId,
    proposalId,
    actorId: humanId,
    outcome: "ACCEPTED",
    createdAt: new Date().toISOString(),
  });

  const found = await decisionRepository.getById(decisionId);
  assert.equal(found?.outcome, "ACCEPTED");
});

test("Decision: repository update rejects, repository delete rejects", async () => {
  const humanId = await makeHuman();
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });
  const decisionId = nextId("decision");
  await decisionRepository.create({
    decisionId,
    proposalId,
    actorId: humanId,
    outcome: "ACCEPTED",
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => decisionRepository.update(decisionId, { outcome: "REJECTED" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => decisionRepository.delete(decisionId), AppendOnlyViolationError);
});

test("Decision: actor type restriction — actorId must be HUMAN_OPERATOR, AGENT is rejected", async () => {
  const agentId = await makeAgent();
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });

  await assert.rejects(
    () =>
      decisionRepository.create({
        decisionId: nextId("decision"),
        proposalId,
        actorId: agentId,
        outcome: "ACCEPTED",
        createdAt: new Date().toISOString(),
      }),
    ActorTypeViolationError,
  );
});

// ---------------------------------------------------------------------------
// KnowledgeCitation
// ---------------------------------------------------------------------------

test("KnowledgeCitation: create succeeds, read succeeds", async () => {
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });

  const citationId = nextId("citation");
  await knowledgeCitationRepository.create({
    citationId,
    attachedToType: "PROPOSAL",
    attachedToId: proposalId,
    sourceRef: "reg-doc-123",
    snippet: "frozen verbatim text",
    retrievedAt: new Date().toISOString(),
  });

  const found = await knowledgeCitationRepository.getById(citationId);
  assert.equal(found?.snippet, "frozen verbatim text");
});

test("KnowledgeCitation: repository update rejects, repository delete rejects", async () => {
  const authorId = await makeHuman();
  const proposalId = nextId("proposal");
  await proposalRepository.create({ proposalId, authorActorId: authorId, createdAt: new Date().toISOString() });
  const citationId = nextId("citation");
  await knowledgeCitationRepository.create({
    citationId,
    attachedToType: "PROPOSAL",
    attachedToId: proposalId,
    sourceRef: "reg-doc-123",
    snippet: "frozen verbatim text",
    retrievedAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => knowledgeCitationRepository.update(citationId, { snippet: "edited text" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => knowledgeCitationRepository.delete(citationId), AppendOnlyViolationError);
});

// ---------------------------------------------------------------------------
// Runtime-vs-compile-time enforcement (all 6 APPEND_ONLY_FACT repositories)
// ---------------------------------------------------------------------------

test("append-only guard rejects mutation at RUNTIME, not only at TypeScript compile time", async () => {
  const actorId = await makeHuman();
  const measurementId = nextId("measurement");
  await measurementRepository.create({
    measurementId,
    sessionId: nextId("session"),
    actorId,
    entryMethod: "MANUAL_ENTERED",
    value: 1,
    unit: "m",
    measurementType: "LENGTH",
    createdAt: new Date().toISOString(),
  });

  // Cast away the TS surface entirely (as a bypassing caller would) and
  // confirm the rejection is still a real thrown error at runtime, not a
  // type-checker-only guarantee.
  const bypassed = measurementRepository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  await assert.rejects(() => bypassed.update!(measurementId, { value: 999 }), AppendOnlyViolationError);
  await assert.rejects(() => bypassed.delete!(measurementId), AppendOnlyViolationError);

  // And prove the underlying Dexie table itself still has the original,
  // untouched value — the guard didn't just throw while silently mutating.
  const raw = await db.measurement.get(measurementId);
  assert.equal(raw?.value, 1);
});
