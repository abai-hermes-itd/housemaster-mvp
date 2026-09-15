import test from "node:test";
import assert from "node:assert/strict";
import { buildingRepository } from "../persistence/repositories/buildingRepository.ts";
import { actorRefRepository } from "../persistence/repositories/actorRefRepository.ts";
import { spatialTargetRepository } from "../persistence/repositories/spatialTargetRepository.ts";
import { ReferenceIdentityRuleViolationError } from "../persistence/guards/errors.ts";
import type { Building } from "../domain/types/Building.ts";
import type { ActorRef } from "../domain/types/ActorRef.ts";
import type { SpatialTarget } from "../domain/types/SpatialTarget.ts";
import { nextId } from "./testIds.ts";

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

test("Building: create/read", async () => {
  const buildingId = nextId("building");
  const building: Building = { buildingId, name: "Original Name" };
  await buildingRepository.create(building);

  const found = await buildingRepository.getById(buildingId);
  assert.equal(found?.buildingId, buildingId);
  assert.equal(found?.name, "Original Name");
});

test("Building: controlled metadata update (name/address only)", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "Before", address: "1 Main St" });

  await buildingRepository.updateDescriptiveMetadata(buildingId, {
    name: "After",
    address: "2 Main St",
  });

  const found = await buildingRepository.getById(buildingId);
  assert.equal(found?.name, "After");
  assert.equal(found?.address, "2 Main St");
});

test("Building: buildingId cannot be changed through the repository API", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "Stable Id" });

  // updateDescriptiveMetadata's own type excludes buildingId; simulate a
  // caller bypassing that with `as any` to prove the *runtime* boundary
  // also holds, not merely the compile-time one.
  await buildingRepository.updateDescriptiveMetadata(buildingId, {
    name: "Still Stable Id",
    // @ts-expect-error — buildingId is intentionally not part of this patch type.
    buildingId: nextId("hijacked"),
  });

  const stillAtOriginalId = await buildingRepository.getById(buildingId);
  assert.equal(stillAtOriginalId?.buildingId, buildingId);
  assert.equal(stillAtOriginalId?.name, "Still Stable Id");
});

// ---------------------------------------------------------------------------
// ActorRef
// ---------------------------------------------------------------------------

test("ActorRef: create/read", async () => {
  const actorId = nextId("actor");
  const actor: ActorRef = { actorId, actorType: "HUMAN_OPERATOR", displayName: "Jordan", status: "ACTIVE" };
  await actorRefRepository.create(actor);

  const found = await actorRefRepository.getById(actorId);
  assert.equal(found?.actorId, actorId);
  assert.equal(found?.displayName, "Jordan");
});

test("ActorRef: actorType accepts HUMAN_OPERATOR", async () => {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "H", status: "ACTIVE" });
  const found = await actorRefRepository.getById(actorId);
  assert.equal(found?.actorType, "HUMAN_OPERATOR");
});

test("ActorRef: actorType accepts AGENT", async () => {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "AGENT", displayName: "Guide", status: "ACTIVE" });
  const found = await actorRefRepository.getById(actorId);
  assert.equal(found?.actorType, "AGENT");
});

test(
  "ActorRef: invalid actor type — no such validation exists at ActorRef's own creation boundary " +
    "(runtime type restriction is enforced downstream, at the point of USE, by fact repositories — see appendOnlyFacts.test.ts's actor-type-restriction tests)",
  async () => {
    const actorId = nextId("actor");
    // ActorRef.actorType is a two-value union at the TYPE level; nothing in
    // IDENTITY_AND_ACCOUNTABILITY.md conditions *ActorRef creation itself*
    // on actorType — the Action -> Actor Requirement table conditions
    // specific downstream actions instead. Documenting this factually
    // rather than inventing a check the frozen docs don't specify.
    await actorRefRepository.create({
      actorId,
      // @ts-expect-error — deliberately invalid, to prove there is no runtime guard here.
      actorType: "NOT_A_REAL_TYPE",
      displayName: "Bogus",
      status: "ACTIVE",
    });
    const found = await actorRefRepository.getById(actorId);
    assert.equal(found?.actorId, actorId, "ActorRef.create() does not itself reject an invalid actorType");
  },
);

test("ActorRef: externalSubjectRef becomes immutable once first set", async () => {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "H", status: "ACTIVE" });
  await actorRefRepository.setExternalSubjectRef(actorId, nextId("sub"));

  await assert.rejects(
    () => actorRefRepository.setExternalSubjectRef(actorId, nextId("sub")),
    ReferenceIdentityRuleViolationError,
  );
});

// ---------------------------------------------------------------------------
// SpatialTarget
// ---------------------------------------------------------------------------

async function makeActor(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "H", status: "ACTIVE" });
  return actorId;
}

test("SpatialTarget: create/read", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "B" });

  const targetId = nextId("target");
  const target: SpatialTarget = {
    targetId,
    buildingId,
    targetType: "ROOM",
    replacesTargetIds: [],
    status: "ACTIVE",
  };
  await spatialTargetRepository.create(target);

  const found = await spatialTargetRepository.getById(targetId);
  assert.equal(found?.targetId, targetId);
  assert.equal(found?.targetType, "ROOM");
});

test("SpatialTarget: same-building lineage (replacesTargetIds) persists", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "B" });

  const predecessorId = nextId("target");
  await spatialTargetRepository.create({
    targetId: predecessorId,
    buildingId,
    targetType: "ROOM",
    replacesTargetIds: [],
    status: "ACTIVE",
  });

  const successorId = nextId("target");
  await spatialTargetRepository.create({
    targetId: successorId,
    buildingId,
    targetType: "ROOM",
    replacesTargetIds: [predecessorId],
    status: "ACTIVE",
  });

  const found = await spatialTargetRepository.getById(successorId);
  assert.deepEqual(found?.replacesTargetIds, [predecessorId]);
});

test("SpatialTarget: self-replacement is rejected", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "B" });

  const targetId = nextId("target");
  await assert.rejects(
    () =>
      spatialTargetRepository.create({
        targetId,
        buildingId,
        targetType: "ROOM",
        replacesTargetIds: [targetId],
        status: "ACTIVE",
      }),
    ReferenceIdentityRuleViolationError,
  );
});

test("SpatialTarget: cross-building predecessor is rejected", async () => {
  const buildingA = nextId("building");
  const buildingB = nextId("building");
  await buildingRepository.create({ buildingId: buildingA, name: "A" });
  await buildingRepository.create({ buildingId: buildingB, name: "B" });

  const predecessorId = nextId("target");
  await spatialTargetRepository.create({
    targetId: predecessorId,
    buildingId: buildingA,
    targetType: "ROOM",
    replacesTargetIds: [],
    status: "ACTIVE",
  });

  const successorId = nextId("target");
  await assert.rejects(
    () =>
      spatialTargetRepository.create({
        targetId: successorId,
        buildingId: buildingB,
        targetType: "ROOM",
        replacesTargetIds: [predecessorId],
        status: "ACTIVE",
      }),
    ReferenceIdentityRuleViolationError,
  );
});

test("SpatialTarget: retirement is terminal (no reactivation)", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "B" });
  const actorId = await makeActor();

  const targetId = nextId("target");
  await spatialTargetRepository.create({
    targetId,
    buildingId,
    targetType: "ROOM",
    replacesTargetIds: [],
    status: "ACTIVE",
  });

  await spatialTargetRepository.retire(targetId, {
    retiredAt: new Date().toISOString(),
    retiredReason: "no longer exists",
    retiredActor: actorId,
  });

  const retired = await spatialTargetRepository.getById(targetId);
  assert.equal(retired?.status, "RETIRED");

  await assert.rejects(
    () =>
      spatialTargetRepository.retire(targetId, {
        retiredAt: new Date().toISOString(),
        retiredReason: "trying to retire again",
        retiredActor: actorId,
      }),
    ReferenceIdentityRuleViolationError,
  );
});
