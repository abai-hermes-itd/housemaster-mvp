/**
 * G1-05B — VERSIONED_APPEND_ONLY: Geometry, FormulaDefinition, DerivedMeasurement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { geometryRepository } from "../persistence/repositories/geometryRepository.ts";
import { formulaDefinitionRepository } from "../persistence/repositories/formulaDefinitionRepository.ts";
import { derivedMeasurementRepository } from "../persistence/repositories/derivedMeasurementRepository.ts";
import { spatialTargetRepository } from "../persistence/repositories/spatialTargetRepository.ts";
import { actorRefRepository } from "../persistence/repositories/actorRefRepository.ts";
import { db } from "../persistence/db.ts";
import { canonicalizeAggregateCalculationScope } from "../domain/types/DerivedMeasurement.ts";
import {
  CANONICAL_ALLOWED_TARGET_TYPES,
  CANONICAL_OUTPUT_QUANTITY_TYPE_ONLY,
  CANONICAL_QUANTITY_CATEGORY,
  CANONICAL_REQUIRED_GEOMETRY_TYPE,
  FROZEN_FORMULA_TYPES,
} from "../domain/types/FormulaDefinition.ts";
import {
  ActorInactiveError,
  ActorNotFoundError,
  ActorTypeViolationError,
  AppendOnlyViolationError,
  ConcurrencyConflictError,
  DuplicateVersionError,
  VersionedAppendOnlyRuleViolationError,
} from "../persistence/guards/errors.ts";
import { nextId } from "./testIds.ts";

// --- SF-03-RECOVERY: real seeded ActorRef reviewers, matching the
// makeHuman()/makeAgent()/makeInactive() pattern already used in
// appendOnlyFacts.test.ts, so overlapReviewedBy resolves through the real
// ActorRef lookup instead of a bare fabricated id. ---
async function makeHumanReviewer(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "Reviewer", status: "ACTIVE" });
  return actorId;
}

async function makeAgentReviewer(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "AGENT", displayName: "Reviewer Bot", status: "ACTIVE" });
  return actorId;
}

async function makeInactiveHumanReviewer(): Promise<string> {
  const actorId = nextId("actor");
  await actorRefRepository.create({ actorId, actorType: "HUMAN_OPERATOR", displayName: "Former Reviewer", status: "INACTIVE" });
  return actorId;
}

// ---------------------------------------------------------------------------
// A. Geometry
// ---------------------------------------------------------------------------

test("Geometry: create v1", async () => {
  const geometryId = nextId("geometry");
  const v1 = await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [4, 0], [4, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });
  assert.equal(v1.version, 1);
  const found = await geometryRepository.getVersion(geometryId, 1);
  assert.deepEqual(found?.coordinates, [[0, 0], [4, 0], [4, 3], [0, 3]]);
});

test("Geometry: create v2 from v1", async () => {
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [4, 0], [4, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });
  const v2 = await geometryRepository.createNextVersion(geometryId, 1, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [5, 0], [5, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });
  assert.equal(v2.version, 2);
});

test("Geometry: v1 remains unchanged/readable after v2 is created", async () => {
  const geometryId = nextId("geometry");
  const originalCoordinates = [[0, 0], [4, 0], [4, 3], [0, 3]];
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYGON",
    coordinates: originalCoordinates,
    createdAt: new Date().toISOString(),
  });
  await geometryRepository.createNextVersion(geometryId, 1, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [5, 0], [5, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });

  const v1 = await geometryRepository.getVersion(geometryId, 1);
  assert.deepEqual(v1?.coordinates, originalCoordinates);
});

test("Geometry: same geometryId with duplicate version rejected (create() rejects a geometryId that already exists)", async () => {
  const geometryId = nextId("geometry");
  const record = {
    geometryId,
    version: 1,
    primitiveType: "POLYGON" as const,
    coordinates: [[0, 0], [1, 0], [1, 1]],
    createdAt: new Date().toISOString(),
  };
  await geometryRepository.create(record);
  // R2-01: create() now rejects any geometryId that already has a
  // version on record (with the more specific
  // VersionedAppendOnlyRuleViolationError), before it would ever reach
  // the underlying compound-key constraint DuplicateVersionError guards.
  await assert.rejects(() => geometryRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

test("Geometry: invalid predecessor version rejected (expectedCurrentVersion does not match reality)", async () => {
  const geometryId = nextId("geometry");
  // No version exists yet, but the caller claims current is 99.
  await assert.rejects(
    () =>
      geometryRepository.createNextVersion(geometryId, 99, {
        primitiveType: "POINT",
        coordinates: [[0, 0]],
        createdAt: new Date().toISOString(),
      }),
    ConcurrencyConflictError,
  );
});

test("Geometry: concurrency/stale expected-version write rejected", async () => {
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POINT",
    coordinates: [[0, 0]],
    createdAt: new Date().toISOString(),
  });
  // First racer succeeds, advancing current to 2.
  await geometryRepository.createNextVersion(geometryId, 1, {
    primitiveType: "POINT",
    coordinates: [[1, 1]],
    createdAt: new Date().toISOString(),
  });
  // Second racer still believes current is 1 (stale) — must be rejected.
  await assert.rejects(
    () =>
      geometryRepository.createNextVersion(geometryId, 1, {
        primitiveType: "POINT",
        coordinates: [[2, 2]],
        createdAt: new Date().toISOString(),
      }),
    ConcurrencyConflictError,
  );
});

test("Geometry: repository update rejects, repository delete rejects", async () => {
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POINT",
    coordinates: [[0, 0]],
    createdAt: new Date().toISOString(),
  });
  await assert.rejects(
    () => geometryRepository.update([geometryId, 1], { primitiveType: "POLYLINE" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => geometryRepository.delete([geometryId, 1]), AppendOnlyViolationError);
});

// --- G1-05B-R2 R2-01: create() hardening ---

test("Geometry: direct create() v1 succeeds for a brand-new geometryId", async () => {
  const geometryId = nextId("geometry");
  const [returnedId, returnedVersion] = await geometryRepository.create({
    geometryId,
    version: 1,
    primitiveType: "POINT",
    coordinates: [[5, 5]],
    createdAt: new Date().toISOString(),
  });
  assert.equal(returnedId, geometryId);
  assert.equal(returnedVersion, 1);
});

test("Geometry: direct create() rejects a non-1 version for a brand-new geometryId", async () => {
  const geometryId = nextId("geometry");
  await assert.rejects(
    () =>
      geometryRepository.create({
        geometryId,
        version: 2,
        primitiveType: "POINT",
        coordinates: [[5, 5]],
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("Geometry: concurrent next-version attempts produce exactly one success and one rejection", async () => {
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POINT",
    coordinates: [[0, 0]],
    createdAt: new Date().toISOString(),
  });

  // Both racers start from the same observed current version (1) and
  // fire without awaiting each other.
  const results = await Promise.allSettled([
    geometryRepository.createNextVersion(geometryId, 1, {
      primitiveType: "POINT",
      coordinates: [[1, 1]],
      createdAt: new Date().toISOString(),
    }),
    geometryRepository.createNextVersion(geometryId, 1, {
      primitiveType: "POINT",
      coordinates: [[2, 2]],
      createdAt: new Date().toISOString(),
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one racer must succeed");
  assert.equal(rejected.length, 1, "exactly one racer must be rejected");
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof ConcurrencyConflictError);

  const versions = await geometryRepository.listVersions(geometryId);
  assert.equal(versions.length, 2, "only one of the two racers actually created a row");
});

// ---------------------------------------------------------------------------
// B. FormulaDefinition
// ---------------------------------------------------------------------------

// SF-02B: FormulaDefinition.allowedTargetTypes/requiredGeometryType/
// outputQuantityType/semanticCategory are now write-time enforced against
// the canonical per-formulaType values (FormulaDefinition.ts). Defaults
// here are computed from that same canonical source so every fixture is
// valid by construction, unless a test deliberately overrides a field to
// exercise a rejection path.
function makeFormulaRecord(overrides: Partial<Parameters<typeof formulaDefinitionRepository.create>[0]> = {}) {
  const formulaType = overrides.formulaType ?? "RECTANGLE_AREA";
  const canonicalQuantityCategory = CANONICAL_QUANTITY_CATEGORY[formulaType];
  const defaultOutputQuantityType: Parameters<typeof formulaDefinitionRepository.create>[0]["outputQuantityType"] =
    canonicalQuantityCategory?.outputQuantityType ?? CANONICAL_OUTPUT_QUANTITY_TYPE_ONLY[formulaType] ?? "AREA";
  const defaultSemanticCategory: Parameters<typeof formulaDefinitionRepository.create>[0]["semanticCategory"] =
    canonicalQuantityCategory?.semanticCategory ?? "RAW_AREA";
  return {
    formulaDefinitionId: nextId("formuladef"),
    formulaType,
    version: 1,
    implementationRef: "impl://rectangle-area/v1",
    implementationHash: "sha256:rect1",
    inputContract: "2 scalar Measurements (length, width)",
    outputQuantityType: defaultOutputQuantityType,
    semanticCategory: defaultSemanticCategory,
    allowedTargetTypes: CANONICAL_ALLOWED_TARGET_TYPES[formulaType],
    requiredGeometryType: CANONICAL_REQUIRED_GEOMETRY_TYPE[formulaType],
    ...overrides,
  };
}

test("FormulaDefinition: create first version", async () => {
  const record = makeFormulaRecord();
  await formulaDefinitionRepository.create(record);
  const found = await formulaDefinitionRepository.getVersion(record.formulaType, 1);
  assert.equal(found?.implementationHash, "sha256:rect1");
});

test("FormulaDefinition: create successor version", async () => {
  const formulaType = "POLYGON_AREA" as const;
  await formulaDefinitionRepository.create(
    makeFormulaRecord({ formulaType, version: 1, implementationHash: "sha256:polyv1" }),
  );
  const v2 = makeFormulaRecord({
    formulaType,
    version: 2,
    implementationHash: "sha256:polyv2",
    supersedesFormulaVersion: 1,
  });
  await formulaDefinitionRepository.create(v2);
  const found = await formulaDefinitionRepository.getVersion(formulaType, 2);
  assert.equal(found?.supersedesFormulaVersion, 1);
});

test("FormulaDefinition: historical version unchanged after a successor is created", async () => {
  const formulaType = "VOLUME" as const;
  await formulaDefinitionRepository.create(
    makeFormulaRecord({ formulaType, version: 1, implementationHash: "sha256:volv1" }),
  );
  await formulaDefinitionRepository.create(
    makeFormulaRecord({ formulaType, version: 2, implementationHash: "sha256:volv2", supersedesFormulaVersion: 1 }),
  );
  const v1 = await formulaDefinitionRepository.getVersion(formulaType, 1);
  assert.equal(v1?.implementationHash, "sha256:volv1");
  assert.equal(v1?.supersedesFormulaVersion, undefined);
});

test("FormulaDefinition: duplicate version rejected", async () => {
  const record = makeFormulaRecord({ formulaType: "POLYLINE_LENGTH" });
  await formulaDefinitionRepository.create(record);
  await assert.rejects(() => formulaDefinitionRepository.create(record), DuplicateVersionError);
});

test("FormulaDefinition: missing predecessor rejected", async () => {
  const record = makeFormulaRecord({
    formulaType: "GROSS_MINUS_OPENINGS",
    version: 2,
    supersedesFormulaVersion: 1,
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

test("FormulaDefinition: branching successor rejected", async () => {
  const formulaType = "AGGREGATE_SUM" as const;
  await formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version: 1 }));
  await formulaDefinitionRepository.create(
    makeFormulaRecord({ formulaType, version: 2, supersedesFormulaVersion: 1 }),
  );
  // A second, different version also claiming to supersede v1.
  await assert.rejects(
    () => formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version: 3, supersedesFormulaVersion: 1 })),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("FormulaDefinition: cycle/self-predecessor rejected", async () => {
  const record = makeFormulaRecord({
    formulaType: "DEFECT_AREA_TOTAL",
    version: 1,
    supersedesFormulaVersion: 1,
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

test("FormulaDefinition: invalid FormulaType rejected at persistence boundary", async () => {
  const record = makeFormulaRecord({
    // @ts-expect-error — deliberately invalid, to prove there is a runtime guard here.
    formulaType: "NOT_A_REAL_FORMULA_TYPE",
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

// --- SF-02B: canonical FormulaDefinition semantic enforcement ---

test("FormulaDefinition: canonically-correct definitions are accepted for every formulaType", async () => {
  for (const formulaType of FROZEN_FORMULA_TYPES) {
    const formula = await makeFormulaDefinition(formulaType);
    const found = await formulaDefinitionRepository.getVersion(formulaType, formula.version);
    assert.equal(found?.formulaType, formulaType);
  }
});

test("FormulaDefinition: allowedTargetTypes not matching the frozen applicability table is rejected", async () => {
  const record = makeFormulaRecord({
    formulaType: "GROSS_MINUS_OPENINGS",
    allowedTargetTypes: ["ROOM"], // real GROSS_MINUS_OPENINGS canonical set is [FACADE, ROOF]
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

test("FormulaDefinition: allowedTargetTypes broader than the frozen table is rejected (not just narrower)", async () => {
  const canonical = CANONICAL_ALLOWED_TARGET_TYPES.GROSS_MINUS_OPENINGS;
  const record = makeFormulaRecord({
    formulaType: "GROSS_MINUS_OPENINGS",
    allowedTargetTypes: [...canonical, "ROOM"], // superset of the canonical set
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

test("FormulaDefinition: requiredGeometryType not matching the frozen contract is rejected", async () => {
  const record = makeFormulaRecord({
    formulaType: "POLYGON_AREA",
    requiredGeometryType: "NONE", // real POLYGON_AREA canonical value is POLYGON
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

test("FormulaDefinition: outputQuantityType/semanticCategory not matching the frozen contract is rejected (fully-determinable formulaType)", async () => {
  const record = makeFormulaRecord({
    formulaType: "VOLUME",
    outputQuantityType: "AREA", // real VOLUME canonical value is VOLUME
    semanticCategory: "RAW_AREA",
  });
  await assert.rejects(() => formulaDefinitionRepository.create(record), VersionedAppendOnlyRuleViolationError);
});

async function nextFreeVersion(formulaType: Parameters<typeof formulaDefinitionRepository.create>[0]["formulaType"]) {
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  return existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
}

test("FormulaDefinition: POLYLINE_LENGTH's outputQuantityType is enforced even though its semanticCategory is deferred", async () => {
  const wrongQuantity = makeFormulaRecord({
    formulaType: "POLYLINE_LENGTH",
    version: await nextFreeVersion("POLYLINE_LENGTH"),
    outputQuantityType: "AREA", // real canonical value is LENGTH — enforced
  });
  await assert.rejects(() => formulaDefinitionRepository.create(wrongQuantity), VersionedAppendOnlyRuleViolationError);

  // semanticCategory is SF-02A DEFERRED_POLYLINE_LENGTH_FIELDS — any value
  // the type system allows must still be accepted at the persistence layer.
  const anyCategoryAccepted = makeFormulaRecord({
    formulaType: "POLYLINE_LENGTH",
    version: await nextFreeVersion("POLYLINE_LENGTH"),
    semanticCategory: "RAW_AREA", // deliberately NOT the "obvious" DEFECT_LENGTH_METRIC guess
  });
  await formulaDefinitionRepository.create(anyCategoryAccepted);
  const found = await formulaDefinitionRepository.getVersion("POLYLINE_LENGTH", anyCategoryAccepted.version);
  assert.equal(found?.semanticCategory, "RAW_AREA");
});

test("FormulaDefinition: AGGREGATE_SUM's outputQuantityType/semanticCategory remain fully unenforced (SF-02A deferred scope)", async () => {
  // AGGREGATE_SUM is deliberately category-generic by design (SF-02A) — no
  // canonical pair exists to enforce, so any combination the type system
  // allows must be accepted.
  const record = makeFormulaRecord({
    formulaType: "AGGREGATE_SUM",
    version: await nextFreeVersion("AGGREGATE_SUM"),
    outputQuantityType: "VOLUME",
    semanticCategory: "VOLUME_METRIC",
  });
  await formulaDefinitionRepository.create(record);
  const found = await formulaDefinitionRepository.getVersion("AGGREGATE_SUM", record.version);
  assert.equal(found?.outputQuantityType, "VOLUME");
  assert.equal(found?.semanticCategory, "VOLUME_METRIC");
});

test("FormulaDefinition: repository update rejects, repository delete rejects", async () => {
  const record = makeFormulaRecord({ formulaType: "DEFECT_LENGTH_TOTAL", version: await nextFreeVersion("DEFECT_LENGTH_TOTAL") });
  await formulaDefinitionRepository.create(record);
  await assert.rejects(
    () => formulaDefinitionRepository.update([record.formulaType, record.version], { implementationHash: "tampered" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => formulaDefinitionRepository.delete([record.formulaType, record.version]), AppendOnlyViolationError);
});

// --- G1-05B-R2 R2-02: successor creation atomicity ---

test("FormulaDefinition: two concurrent successor creates against the same predecessor — exactly one succeeds, exactly one rejects", async () => {
  const formulaType = "RECTANGLE_AREA" as const;
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  const predecessorVersion = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
  await formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version: predecessorVersion }));

  // Two different candidate successor versions, both claiming the same
  // predecessor, fired without awaiting each other.
  const results = await Promise.allSettled([
    formulaDefinitionRepository.create(
      makeFormulaRecord({
        formulaType,
        version: predecessorVersion + 1,
        supersedesFormulaVersion: predecessorVersion,
      }),
    ),
    formulaDefinitionRepository.create(
      makeFormulaRecord({
        formulaType,
        version: predecessorVersion + 2,
        supersedesFormulaVersion: predecessorVersion,
      }),
    ),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one racer must succeed");
  assert.equal(rejected.length, 1, "exactly one racer must be rejected");
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof VersionedAppendOnlyRuleViolationError);
});

test("FormulaDefinition: lifecycle status remains derived correctly (ACTIVE, then DEPRECATED once superseded)", async () => {
  const formulaType = "GROSS_MINUS_OPENINGS" as const;
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
  await formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version }));
  assert.equal(await formulaDefinitionRepository.getLifecycleStatus(formulaType, version), "ACTIVE");

  await formulaDefinitionRepository.create(
    makeFormulaRecord({ formulaType, version: version + 1, supersedesFormulaVersion: version }),
  );
  assert.equal(await formulaDefinitionRepository.getLifecycleStatus(formulaType, version), "DEPRECATED");
  assert.equal(await formulaDefinitionRepository.getLifecycleStatus(formulaType, version + 1), "ACTIVE");
});

// ---------------------------------------------------------------------------
// C. DerivedMeasurement
// ---------------------------------------------------------------------------

// formulaType is one of only 8 fixed enum values (unlike the other ids in
// this file, which are all freshly generated via nextId()), and section B
// above also creates real rows for several of these same formulaTypes
// directly — so this helper must look up whatever actually exists in the
// shared store and use the next free version, rather than assuming v1.
async function makeFormulaDefinition(formulaType: Parameters<typeof formulaDefinitionRepository.create>[0]["formulaType"]) {
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
  const record = makeFormulaRecord({ formulaType, version });
  await formulaDefinitionRepository.create(record);
  return record;
}

// --- G1-05B-SH2: fixtures for the write-time applicability/aggregate/
// overlap checks added to derivedMeasurementRepository.create() ---

/**
 * A real, persisted SpatialTarget — every `makeFormulaRecord()` fixture
 * uses `allowedTargetTypes: ["ROOM", "FACADE"]`, so "ROOM" satisfies every
 * formulaType's applicability check by default.
 */
async function makeTarget(
  targetType: Parameters<typeof spatialTargetRepository.create>[0]["targetType"] = "ROOM",
) {
  const targetId = nextId("target");
  await spatialTargetRepository.create({
    targetId,
    buildingId: nextId("building"),
    targetType,
    replacesTargetIds: [],
    status: "ACTIVE",
  });
  return targetId;
}

/**
 * A real, valid single-subject DerivedMeasurement (via a real RECTANGLE_AREA
 * FormulaDefinition + a real SpatialTarget) to use as a source input for an
 * aggregate-formula test — so aggregate-source validation (existence,
 * homogeneity, applicable targetType) has something real to resolve
 * against, instead of a bare fabricated id.
 */
async function makeSourceDerivedMeasurement(fields: {
  outputQuantityType: Parameters<typeof derivedMeasurementRepository.create>[0]["outputQuantityType"];
  semanticCategory: Parameters<typeof derivedMeasurementRepository.create>[0]["semanticCategory"];
  targetType?: Parameters<typeof spatialTargetRepository.create>[0]["targetType"];
}) {
  const targetType = fields.targetType ?? "ROOM";
  const targetId = await makeTarget(targetType);
  const derivedMeasurementId = nextId("derived");
  // DEFECT_LINEAR is only in POLYLINE_LENGTH's canonical allowedTargetTypes
  // (SF-02B) — RECTANGLE_AREA doesn't allow it — so a DEFECT_LINEAR-targeted
  // source needs POLYLINE_LENGTH + a real POLYLINE geometry (its canonical
  // requiredGeometryType). Every other target type still uses RECTANGLE_AREA
  // (no geometry required), unchanged.
  if (targetType === "DEFECT_LINEAR") {
    const sourceFormula = await makeFormulaDefinition("POLYLINE_LENGTH");
    const geometryId = nextId("geometry");
    await geometryRepository.createNextVersion(geometryId, 0, {
      primitiveType: "POLYLINE",
      coordinates: [[0, 0], [1, 1]],
      createdAt: new Date().toISOString(),
    });
    await derivedMeasurementRepository.create({
      derivedMeasurementId,
      formulaType: sourceFormula.formulaType,
      formulaVersion: sourceFormula.version,
      inputMeasurementIds: [],
      inputGeometryRefs: [{ geometryId, version: 1 }],
      inputDerivedMeasurementIds: [],
      targetId,
      outputQuantityType: fields.outputQuantityType,
      semanticCategory: fields.semanticCategory,
      calculationScope: targetId,
      createdAt: new Date().toISOString(),
    });
    return derivedMeasurementId;
  }
  const sourceFormula = await makeFormulaDefinition("RECTANGLE_AREA");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: sourceFormula.formulaType,
    formulaVersion: sourceFormula.version,
    inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: fields.outputQuantityType,
    semanticCategory: fields.semanticCategory,
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  return derivedMeasurementId;
}

test("DerivedMeasurement: create initial version", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.equal(found?.targetId, targetId);
});

test("DerivedMeasurement: create successor/correction version", async () => {
  const formula = await makeFormulaDefinition("POLYGON_AREA");
  const targetId = await makeTarget();
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [4, 0], [4, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });
  await geometryRepository.createNextVersion(geometryId, 1, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [5, 0], [5, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });
  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [{ geometryId, version: 1 }],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  const v2Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v2Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [{ geometryId, version: 2 }],
    inputDerivedMeasurementIds: [],
    supersedesDerivedMeasurementId: v1Id,
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  const v2 = await derivedMeasurementRepository.getById(v2Id);
  assert.equal(v2?.supersedesDerivedMeasurementId, v1Id);
});

test("DerivedMeasurement: old result remains unchanged/readable after a successor is created", async () => {
  const formula = await makeFormulaDefinition("VOLUME");
  const targetId = await makeTarget();
  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "VOLUME",
    semanticCategory: "VOLUME_METRIC",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  await derivedMeasurementRepository.create({
    derivedMeasurementId: nextId("derived"),
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    supersedesDerivedMeasurementId: v1Id,
    targetId,
    outputQuantityType: "VOLUME",
    semanticCategory: "VOLUME_METRIC",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  const v1 = await derivedMeasurementRepository.getById(v1Id);
  assert.equal(v1?.derivedMeasurementId, v1Id);
  assert.equal(v1?.supersedesDerivedMeasurementId, undefined);
});

test("DerivedMeasurement: duplicate id rejected", async () => {
  const formula = await makeFormulaDefinition("POLYLINE_LENGTH");
  const targetId = await makeTarget("DEFECT_LINEAR");
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYLINE",
    coordinates: [[0, 0], [1, 1]],
    createdAt: new Date().toISOString(),
  });
  const record = {
    derivedMeasurementId: nextId("derived"),
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [{ geometryId, version: 1 }],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "LENGTH" as const,
    semanticCategory: "DEFECT_LENGTH_METRIC" as const,
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  };
  await derivedMeasurementRepository.create(record);
  await assert.rejects(() => derivedMeasurementRepository.create(record));
});

test("DerivedMeasurement: formulaDefinition reference must exist", async () => {
  const targetId = nextId("target");
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: "AGGREGATE_SUM",
        // A version number no test in this file ever creates for
        // AGGREGATE_SUM, guaranteeing the reference genuinely doesn't exist
        // regardless of what other tests already created for this formulaType.
        formulaVersion: 999_999,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [nextId("derived")],
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: referenced formulaDefinition version must exist (formulaType exists, version does not)", async () => {
  const formula = await makeFormulaDefinition("DEFECT_AREA_TOTAL");
  const targetId = nextId("target");
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: 99, // formulaType exists, but not v99
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [nextId("derived")],
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "DEFECT_AREA_METRIC",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: exact input IDs preserved", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const measurementIds = [nextId("measurement"), nextId("measurement")];
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: measurementIds,
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.deepEqual(found?.inputMeasurementIds, measurementIds);
});

test("DerivedMeasurement: aggregate input set preserved exactly", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const sourceDerivedIds = [
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
  ];
  const derivedMeasurementId = nextId("derived");
  const declaredScopeLabel = `parent:${parentTargetId}`;
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: sourceDerivedIds,
    targetId: parentTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: declaredScopeLabel,
    overlapReviewedBy: await makeHumanReviewer(),
    overlapReviewedAt: new Date().toISOString(),
    overlapRiskNoted: true,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.deepEqual(found?.inputDerivedMeasurementIds, sourceDerivedIds);
  // For an aggregate formula, the persisted calculationScope is the
  // canonical form (declared label + exact resolved input set) computed
  // by the repository — not the raw label the caller passed in.
  assert.equal(
    found?.calculationScope,
    canonicalizeAggregateCalculationScope(declaredScopeLabel, {
      inputMeasurementIds: [],
      inputGeometryRefs: [],
      inputDerivedMeasurementIds: sourceDerivedIds,
    }),
  );
  assert.equal(found?.overlapRiskNoted, true);
});

test("DerivedMeasurement: missing predecessor rejected", async () => {
  const formula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const targetId = await makeTarget();
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        supersedesDerivedMeasurementId: nextId("nonexistent-derived"),
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "NET_AREA",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: supersession across a different semanticResultKey is rejected", async () => {
  const formula = await makeFormulaDefinition("DEFECT_LENGTH_TOTAL");
  const targetId = nextId("target");
  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [
      await makeSourceDerivedMeasurement({ outputQuantityType: "LENGTH", semanticCategory: "DEFECT_LENGTH_METRIC", targetType: "DEFECT_LINEAR" }),
    ],
    targetId,
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  const anotherSourceId = await makeSourceDerivedMeasurement({
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    targetType: "DEFECT_LINEAR",
  });
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [anotherSourceId],
        supersedesDerivedMeasurementId: v1Id,
        targetId: nextId("a-different-target"), // different targetId -> different semanticResultKey
        outputQuantityType: "LENGTH",
        semanticCategory: "DEFECT_LENGTH_METRIC",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: repository update rejects, repository delete rejects", async () => {
  const formula = await makeFormulaDefinition("VOLUME");
  const targetId = await makeTarget();
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "VOLUME",
    semanticCategory: "VOLUME_METRIC",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () => derivedMeasurementRepository.update(derivedMeasurementId, { calculationScope: "tampered" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => derivedMeasurementRepository.delete(derivedMeasurementId), AppendOnlyViolationError);
});

// --- G1-05B-R2 R2-03: successor creation atomicity ---

test("DerivedMeasurement: a second sequential successor to the same predecessor is rejected", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  await derivedMeasurementRepository.create({
    derivedMeasurementId: nextId("derived"),
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    supersedesDerivedMeasurementId: v1Id,
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        supersedesDerivedMeasurementId: v1Id,
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: two concurrent successor creates against the same predecessor — exactly one succeeds, exactly one rejects", async () => {
  const formula = await makeFormulaDefinition("VOLUME");
  const targetId = await makeTarget();
  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "VOLUME",
    semanticCategory: "VOLUME_METRIC",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });

  const results = await Promise.allSettled([
    derivedMeasurementRepository.create({
      derivedMeasurementId: nextId("derived"),
      formulaType: formula.formulaType,
      formulaVersion: formula.version,
      inputMeasurementIds: [nextId("measurement")],
      inputGeometryRefs: [],
      inputDerivedMeasurementIds: [],
      supersedesDerivedMeasurementId: v1Id,
      targetId,
      outputQuantityType: "VOLUME",
      semanticCategory: "VOLUME_METRIC",
      calculationScope: targetId,
      createdAt: new Date().toISOString(),
    }),
    derivedMeasurementRepository.create({
      derivedMeasurementId: nextId("derived"),
      formulaType: formula.formulaType,
      formulaVersion: formula.version,
      inputMeasurementIds: [nextId("measurement")],
      inputGeometryRefs: [],
      inputDerivedMeasurementIds: [],
      supersedesDerivedMeasurementId: v1Id,
      targetId,
      outputQuantityType: "VOLUME",
      semanticCategory: "VOLUME_METRIC",
      calculationScope: targetId,
      createdAt: new Date().toISOString(),
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one racer must succeed");
  assert.equal(rejected.length, 1, "exactly one racer must be rejected");
  assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof VersionedAppendOnlyRuleViolationError);
});

test("DerivedMeasurement: historical pinned FormulaDefinition version remains unchanged after being referenced", async () => {
  const formula = await makeFormulaDefinition("DEFECT_AREA_TOTAL");
  const before = await formulaDefinitionRepository.getVersion(formula.formulaType, formula.version);
  const targetId = nextId("target");
  const sourceId = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "DEFECT_AREA_METRIC", targetType: "DEFECT_AREA" });
  await derivedMeasurementRepository.create({
    derivedMeasurementId: nextId("derived"),
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [sourceId],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "DEFECT_AREA_METRIC",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  const after = await formulaDefinitionRepository.getVersion(formula.formulaType, formula.version);
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// G1-05B-FIX — calculationScope canonical input-set encoding for aggregate
// formulas (AGGREGATE_SUM, DEFECT_AREA_TOTAL, DEFECT_LENGTH_TOTAL).
// ---------------------------------------------------------------------------

test("canonicalizeAggregateCalculationScope: same inputs in different order yield an identical canonical value", () => {
  const scope = "parent:X";
  const a = canonicalizeAggregateCalculationScope(scope, {
    inputMeasurementIds: ["m1", "m2"],
    inputGeometryRefs: [
      { geometryId: "g1", version: 1 },
      { geometryId: "g2", version: 3 },
    ],
    inputDerivedMeasurementIds: ["d1", "d2"],
  });
  const b = canonicalizeAggregateCalculationScope(scope, {
    // Same three sets, every array reordered.
    inputMeasurementIds: ["m2", "m1"],
    inputGeometryRefs: [
      { geometryId: "g2", version: 3 },
      { geometryId: "g1", version: 1 },
    ],
    inputDerivedMeasurementIds: ["d2", "d1"],
  });
  assert.equal(a, b);
});

test("canonicalizeAggregateCalculationScope: different inputMeasurementIds yield a different canonical value", () => {
  const base = { inputGeometryRefs: [], inputDerivedMeasurementIds: [] };
  const a = canonicalizeAggregateCalculationScope("parent:X", { ...base, inputMeasurementIds: ["m1", "m2"] });
  const b = canonicalizeAggregateCalculationScope("parent:X", { ...base, inputMeasurementIds: ["m1", "m3"] });
  assert.notEqual(a, b);
});

test("canonicalizeAggregateCalculationScope: different inputGeometryRefs yield a different canonical value", () => {
  const base = { inputMeasurementIds: [], inputDerivedMeasurementIds: [] };
  const a = canonicalizeAggregateCalculationScope("parent:X", {
    ...base,
    inputGeometryRefs: [{ geometryId: "g1", version: 1 }],
  });
  const b = canonicalizeAggregateCalculationScope("parent:X", {
    ...base,
    inputGeometryRefs: [{ geometryId: "g1", version: 2 }],
  });
  assert.notEqual(a, b);
});

test("canonicalizeAggregateCalculationScope: different inputDerivedMeasurementIds yield a different canonical value", () => {
  const base = { inputMeasurementIds: [], inputGeometryRefs: [] };
  const a = canonicalizeAggregateCalculationScope("parent:X", { ...base, inputDerivedMeasurementIds: ["d1"] });
  const b = canonicalizeAggregateCalculationScope("parent:X", { ...base, inputDerivedMeasurementIds: ["d2"] });
  assert.notEqual(a, b);
});

test("canonicalizeAggregateCalculationScope: geometry refs canonicalize by geometryId AND version", () => {
  const base = { inputMeasurementIds: [], inputDerivedMeasurementIds: [] };
  const sameIdDifferentVersion = canonicalizeAggregateCalculationScope("parent:X", {
    ...base,
    inputGeometryRefs: [{ geometryId: "g1", version: 1 }],
  });
  const sameIdBumpedVersion = canonicalizeAggregateCalculationScope("parent:X", {
    ...base,
    inputGeometryRefs: [{ geometryId: "g1", version: 2 }],
  });
  const differentIdSameVersion = canonicalizeAggregateCalculationScope("parent:X", {
    ...base,
    inputGeometryRefs: [{ geometryId: "g2", version: 1 }],
  });
  assert.notEqual(sameIdDifferentVersion, sameIdBumpedVersion, "version alone must change the canonical value");
  assert.notEqual(sameIdDifferentVersion, differentIdSameVersion, "geometryId alone must change the canonical value");
});

// --- G1-05B-R2 R2-04: JSON canonicalization must be collision-safe ---

test('canonicalizeAggregateCalculationScope: ["a,b"] and ["a","b"] are collision-safe (different canonical values)', () => {
  const oneIdContainingAComma = canonicalizeAggregateCalculationScope("parent:X", {
    inputMeasurementIds: ["a,b"],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
  });
  const twoSeparateIds = canonicalizeAggregateCalculationScope("parent:X", {
    inputMeasurementIds: ["a", "b"],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
  });
  assert.notEqual(
    oneIdContainingAComma,
    twoSeparateIds,
    "a delimiter-joined encoding would have collided here; JSON serialization must not",
  );
});

test("canonicalizeAggregateCalculationScope: scope/ids containing '|', ',', '@v', quotes, and backslashes are safe and distinct", () => {
  const weirdScope = 'scope|with,special@v1"chars\\here';
  const weird = canonicalizeAggregateCalculationScope(weirdScope, {
    inputMeasurementIds: ['id"with\\quote', "id,with|pipe@v9"],
    inputGeometryRefs: [{ geometryId: "g@v9|weird", version: 1 }],
    inputDerivedMeasurementIds: [],
  });
  const plain = canonicalizeAggregateCalculationScope("a-completely-different-plain-scope", {
    inputMeasurementIds: ["totally-different"],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
  });
  assert.notEqual(weird, plain);
  // The value must remain valid, parseable JSON — human-inspectable, not
  // corrupted or truncated by the special characters it contains.
  const parsed = JSON.parse(weird) as { scope: string; measurements: string[] };
  assert.equal(parsed.scope, weirdScope);
  assert.deepEqual(parsed.measurements, ['id"with\\quote', "id,with|pipe@v9"].sort());
});

test("canonicalizeAggregateCalculationScope: duplicate-sensitive — a repeated id is preserved, not deduplicated", () => {
  const withDuplicate = canonicalizeAggregateCalculationScope("parent:X", {
    inputMeasurementIds: ["m1", "m1"],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
  });
  const withoutDuplicate = canonicalizeAggregateCalculationScope("parent:X", {
    inputMeasurementIds: ["m1"],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
  });
  assert.notEqual(withDuplicate, withoutDuplicate, "no deduplication may be invented");
  const parsed = JSON.parse(withDuplicate) as { measurements: string[] };
  assert.deepEqual(parsed.measurements, ["m1", "m1"]);
});

test("canonicalizeAggregateCalculationScope: does not mutate the caller's input arrays", () => {
  const measurementIds = ["m2", "m1"];
  const geometryRefs = [
    { geometryId: "g2", version: 1 },
    { geometryId: "g1", version: 1 },
  ];
  const derivedIds = ["d2", "d1"];
  canonicalizeAggregateCalculationScope("parent:X", {
    inputMeasurementIds: measurementIds,
    inputGeometryRefs: geometryRefs,
    inputDerivedMeasurementIds: derivedIds,
  });
  assert.deepEqual(measurementIds, ["m2", "m1"]);
  assert.deepEqual(geometryRefs, [
    { geometryId: "g2", version: 1 },
    { geometryId: "g1", version: 1 },
  ]);
  assert.deepEqual(derivedIds, ["d2", "d1"]);
});

test("DerivedMeasurement: AGGREGATE_SUM calculationScope contains the declared scope + canonical exact input set", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const declaredScopeLabel = `parent:${parentTargetId}`;
  const inputDerivedMeasurementIds = [
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
  ];
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds,
    targetId: parentTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: declaredScopeLabel,
    overlapReviewedBy: await makeHumanReviewer(),
    overlapReviewedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  const expected = canonicalizeAggregateCalculationScope(declaredScopeLabel, {
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds,
  });
  assert.equal(found?.calculationScope, expected);
  // Sanity: the canonical JSON value visibly contains both the declared
  // label and every pinned input id in cleartext — human-inspectable,
  // not a hash-only representation.
  assert.ok(found?.calculationScope.includes(declaredScopeLabel));
  for (const id of inputDerivedMeasurementIds) {
    assert.ok(found?.calculationScope.includes(id));
  }
});

test("DerivedMeasurement: supersession succeeds when the SAME aggregate inputs are supplied in a different order", async () => {
  const formula = await makeFormulaDefinition("DEFECT_AREA_TOTAL");
  const parentTargetId = nextId("target");
  const declaredScopeLabel = `parent:${parentTargetId}`;
  const sourceA = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "DEFECT_AREA_METRIC", targetType: "DEFECT_AREA" });
  const sourceB = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "DEFECT_AREA_METRIC", targetType: "DEFECT_AREA" });

  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [sourceA, sourceB],
    targetId: parentTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "DEFECT_AREA_METRIC",
    calculationScope: declaredScopeLabel,
    overlapReviewedBy: await makeHumanReviewer(),
    overlapReviewedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  // Same declared label, same two source ids, supplied in reverse order.
  const v2Id = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v2Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [sourceB, sourceA],
    supersedesDerivedMeasurementId: v1Id,
    targetId: parentTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "DEFECT_AREA_METRIC",
    calculationScope: declaredScopeLabel,
    overlapReviewedBy: await makeHumanReviewer(),
    overlapReviewedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  const v2 = await derivedMeasurementRepository.getById(v2Id);
  assert.equal(v2?.supersedesDerivedMeasurementId, v1Id);
  const v1 = await derivedMeasurementRepository.getById(v1Id);
  assert.equal(v1?.calculationScope, v2?.calculationScope, "reordered-but-identical input sets canonicalize identically");
});

test("DerivedMeasurement: supersession is rejected when aggregate inputs genuinely differ (different canonical calculationScope)", async () => {
  const formula = await makeFormulaDefinition("DEFECT_LENGTH_TOTAL");
  const parentTargetId = nextId("target");
  const declaredScopeLabel = `parent:${parentTargetId}`;

  const v1Id = nextId("derived");
  const v1SourceId = await makeSourceDerivedMeasurement({ outputQuantityType: "LENGTH", semanticCategory: "DEFECT_LENGTH_METRIC", targetType: "DEFECT_LINEAR" });
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [v1SourceId],
    targetId: parentTargetId,
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    calculationScope: declaredScopeLabel,
    createdAt: new Date().toISOString(),
  });

  // Same declared label, but a genuinely different resolved input set —
  // per the frozen text, this must NOT compare as the same
  // semanticResultKey, even though the label alone matches.
  const differentSourceId = await makeSourceDerivedMeasurement({
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    targetType: "DEFECT_LINEAR",
  });
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [differentSourceId],
        supersedesDerivedMeasurementId: v1Id,
        targetId: parentTargetId,
        outputQuantityType: "LENGTH",
        semanticCategory: "DEFECT_LENGTH_METRIC",
        calculationScope: declaredScopeLabel,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

// ---------------------------------------------------------------------------
// G1-05B-SH2 — write-time applicability / aggregate-input-contract /
// overlap-acknowledgement checks (FORMULA_AND_DERIVATION_CONTRACT.md).
// ---------------------------------------------------------------------------

test("DerivedMeasurement: rejected when targetId's targetType is not in the formula's allowedTargetTypes", async () => {
  const formulaType = "VOLUME" as const;
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
  // VOLUME's real applicability table excludes OPENING entirely; the shared
  // makeFormulaRecord() fixture only ever declares ["ROOM", "FACADE"].
  await formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version }));
  const targetId = await makeTarget("OPENING");

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType,
        formulaVersion: version,
        inputMeasurementIds: [nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "VOLUME",
        semanticCategory: "VOLUME_METRIC",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: rejected when targetId does not reference an existing SpatialTarget", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = nextId("nonexistent-target");

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: rejected when a pinned geometry's primitiveType does not match the formula's requiredGeometryType", async () => {
  const formulaType = "POLYGON_AREA" as const;
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
  await formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version, requiredGeometryType: "POLYGON" }));
  const targetId = await makeTarget();
  const geometryId = nextId("geometry");
  // A POLYLINE, not the required POLYGON.
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYLINE",
    coordinates: [[0, 0], [1, 1]],
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType,
        formulaVersion: version,
        inputMeasurementIds: [],
        inputGeometryRefs: [{ geometryId, version: 1 }],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: accepted when the pinned geometry's primitiveType matches the formula's requiredGeometryType", async () => {
  const formulaType = "POLYGON_AREA" as const;
  const existing = await formulaDefinitionRepository.listVersions(formulaType);
  const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;
  await formulaDefinitionRepository.create(makeFormulaRecord({ formulaType, version, requiredGeometryType: "POLYGON" }));
  const targetId = await makeTarget();
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [4, 0], [4, 3], [0, 3]],
    createdAt: new Date().toISOString(),
  });

  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType,
    formulaVersion: version,
    inputMeasurementIds: [],
    inputGeometryRefs: [{ geometryId, version: 1 }],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.equal(found?.derivedMeasurementId, derivedMeasurementId);
});

test("DerivedMeasurement: AGGREGATE_SUM with 2+ inputs and no overlap acknowledgement is rejected", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const sources = [
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
    await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" }),
  ];

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: sources,
        targetId: parentTargetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: `parent:${parentTargetId}`,
        // overlapReviewedBy/overlapReviewedAt deliberately omitted.
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: AGGREGATE_SUM with a single input does not require overlap acknowledgement", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const source = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" });

  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [source],
    targetId: parentTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: `parent:${parentTargetId}`,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.equal(found?.derivedMeasurementId, derivedMeasurementId);
});

test("DerivedMeasurement: AGGREGATE_SUM sources spanning 2 distinct source targetTypes are rejected", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const roomSource = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" });
  // A source whose own target is FACADE, not ROOM — allowedTargetTypes on
  // the shared fixture is ["ROOM", "FACADE"], so this is individually
  // applicable, but mixing it with a ROOM source violates "exactly one
  // explicit source targetType."
  const facadeFormula = await makeFormulaDefinition("RECTANGLE_AREA");
  const facadeTargetId = await makeTarget("FACADE");
  const facadeSourceId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: facadeSourceId,
    formulaType: facadeFormula.formulaType,
    formulaVersion: facadeFormula.version,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId: facadeTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: facadeTargetId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [roomSource, facadeSourceId],
        targetId: parentTargetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: `parent:${parentTargetId}`,
        overlapReviewedBy: nextId("actor"),
        overlapReviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: AGGREGATE_SUM with a duplicate source targetId is rejected", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const sharedTargetId = await makeTarget();
  const sourceFormula = await makeFormulaDefinition("RECTANGLE_AREA");

  async function sourceOnSharedTarget() {
    const derivedMeasurementId = nextId("derived");
    await derivedMeasurementRepository.create({
      derivedMeasurementId,
      formulaType: sourceFormula.formulaType,
      formulaVersion: sourceFormula.version,
      inputMeasurementIds: [nextId("measurement")],
      inputGeometryRefs: [],
      inputDerivedMeasurementIds: [],
      targetId: sharedTargetId,
      outputQuantityType: "AREA",
      semanticCategory: "RAW_AREA",
      calculationScope: sharedTargetId,
      createdAt: new Date().toISOString(),
    });
    return derivedMeasurementId;
  }
  // Two independent (non-superseding) DerivedMeasurement rows for the
  // SAME source targetId — an aggregate must never include both.
  const sourceOne = await sourceOnSharedTarget();
  const sourceTwo = await sourceOnSharedTarget();

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [sourceOne, sourceTwo],
        targetId: parentTargetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: `parent:${parentTargetId}`,
        overlapReviewedBy: nextId("actor"),
        overlapReviewedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("DerivedMeasurement: AGGREGATE_SUM source with mismatched outputQuantityType is rejected", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const mismatchedSource = await makeSourceDerivedMeasurement({ outputQuantityType: "LENGTH", semanticCategory: "DEFECT_LENGTH_METRIC" });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [mismatchedSource],
        targetId: parentTargetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: `parent:${parentTargetId}`,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

// ---------------------------------------------------------------------------
// G1-05B-GMO-IMP-01 — GROSS_MINUS_OPENINGS host/openings structural
// implementation (FORMULA_AND_DERIVATION_CONTRACT.md §"GROSS_MINUS_OPENINGS
// — host/openings structural split").
// ---------------------------------------------------------------------------

/** A FACADE/ROOF host target — real SpatialTarget, so openings can share its buildingId. */
async function makeHostTarget(targetType: "FACADE" | "ROOF" = "FACADE") {
  const targetId = nextId("target");
  const buildingId = nextId("building");
  await spatialTargetRepository.create({
    targetId,
    buildingId,
    targetType,
    replacesTargetIds: [],
    status: "ACTIVE",
  });
  return { targetId, buildingId };
}

/** An OPENING target parented to the given host, in the host's own building. */
async function makeOpeningTarget(host: { targetId: string; buildingId: string }) {
  const targetId = nextId("target");
  await spatialTargetRepository.create({
    targetId,
    buildingId: host.buildingId,
    targetType: "OPENING",
    parentTargetId: host.targetId,
    replacesTargetIds: [],
    status: "ACTIVE",
  });
  return targetId;
}

/** A real gross-area (AREA/RAW_AREA) DerivedMeasurement result on the given targetId. */
async function makeGmoAreaResult(targetId: string) {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  return derivedMeasurementId;
}

/**
 * A real gross-area DerivedMeasurement result on an OPENING targetId.
 * POLYGON_AREA's real canonical allowedTargetTypes already includes
 * OPENING, so a plain FormulaDefinition suffices — but its canonical
 * requiredGeometryType is POLYGON, so a real Geometry row is now required
 * too (SF-02B).
 */
async function makeGmoOpeningResult(openingTargetId: string) {
  const formula = await makeFormulaDefinition("POLYGON_AREA");
  const geometryId = nextId("geometry");
  await geometryRepository.createNextVersion(geometryId, 0, {
    primitiveType: "POLYGON",
    coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
    createdAt: new Date().toISOString(),
  });
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [{ geometryId, version: 1 }],
    inputDerivedMeasurementIds: [],
    targetId: openingTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: openingTargetId,
    createdAt: new Date().toISOString(),
  });
  return derivedMeasurementId;
}

function makeGmoRecord(overrides: Partial<Parameters<typeof derivedMeasurementRepository.create>[0]> = {}) {
  return {
    derivedMeasurementId: nextId("derived"),
    formulaType: "GROSS_MINUS_OPENINGS" as const,
    formulaVersion: 1,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId: nextId("target"),
    outputQuantityType: "AREA" as const,
    semanticCategory: "NET_AREA" as const,
    calculationScope: nextId("target"),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("GROSS_MINUS_OPENINGS: host + 1 opening + overlap ack succeeds", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingTargetId = await makeOpeningTarget(host);
  const openingResultId = await makeGmoOpeningResult(openingTargetId);

  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create(
    makeGmoRecord({
      derivedMeasurementId,
      formulaVersion: gmoFormula.version,
      grossSourceDerivedMeasurementId,
      inputDerivedMeasurementIds: [openingResultId],
      targetId: host.targetId,
      calculationScope: host.targetId,
      overlapReviewedBy: await makeHumanReviewer(),
      overlapReviewedAt: new Date().toISOString(),
    }),
  );
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.equal(found?.grossSourceDerivedMeasurementId, grossSourceDerivedMeasurementId);
  assert.deepEqual(found?.inputDerivedMeasurementIds, [openingResultId]);
});

test("GROSS_MINUS_OPENINGS: missing grossSourceDerivedMeasurementId is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: grossSourceDerivedMeasurementId on a non-GMO formulaType is rejected", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const someOtherId = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        grossSourceDerivedMeasurementId: someOtherId,
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: targetId,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: self-referential grossSourceDerivedMeasurementId is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));
  const derivedMeasurementId = nextId("derived");

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          derivedMeasurementId,
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId: derivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: nonexistent grossSourceDerivedMeasurementId is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId: nextId("nonexistent-derived"),
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: host targetId not matching record.targetId is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const otherHost = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: otherHost.targetId, // mismatch: host result's own targetId is `host`, not `otherHost`
          calculationScope: otherHost.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: host with wrong outputQuantityType/semanticCategory is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  // A LENGTH/DEFECT_LENGTH_METRIC result — not a legitimate gross-area source.
  const wrongTypeHost = await makeSourceDerivedMeasurement({
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
  });
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId: wrongTypeHost,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: host also listed as an opening is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [grossSourceDerivedMeasurementId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: zero openings is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: opening with wrong outputQuantityType is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingTargetId = await makeOpeningTarget(host);
  // POLYLINE_LENGTH's real canonical allowedTargetTypes ([DEFECT_LINEAR])
  // never includes OPENING, so a real derivedMeasurementRepository.create()
  // call can never produce a LENGTH-typed result on an OPENING target —
  // seed the row directly (bypassing repository-level applicability
  // checks) so this test can exercise the GMO opening-quantity check
  // against an EXISTING row, regardless of how it came to exist.
  const lengthFormula = await makeFormulaDefinition("POLYLINE_LENGTH");
  const wrongQuantityOpening = nextId("derived");
  await db.derivedMeasurement.add({
    derivedMeasurementId: wrongQuantityOpening,
    formulaType: lengthFormula.formulaType,
    formulaVersion: lengthFormula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId: openingTargetId,
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    calculationScope: openingTargetId,
    createdAt: new Date().toISOString(),
  });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [wrongQuantityOpening],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: opening whose target is not OPENING-typed is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  // A ROOM result, not an OPENING — wrong target kind entirely.
  const roomResultId = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" });

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [roomResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: opening parented to a different host is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const differentHost = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  // Opening is parented to `differentHost`, not `host`.
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(differentHost));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: duplicate opening source targetId is rejected", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingTargetId = await makeOpeningTarget(host);
  const openingResultOne = await makeGmoOpeningResult(openingTargetId);
  // Second, independent result on the SAME opening targetId.
  const openingResultTwo = await makeGmoOpeningResult(openingTargetId);

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultOne, openingResultTwo],
          targetId: host.targetId,
          calculationScope: host.targetId,
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: historical (superseded) host and opening sources remain valid pins", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");

  // Host result, then superseded by a correction — same semanticResultKey (targetId/outputQuantityType/semanticCategory/calculationScope).
  const hostV1 = await makeGmoAreaResult(host.targetId);
  const hostFormula = await makeFormulaDefinition("RECTANGLE_AREA");
  await derivedMeasurementRepository.create({
    derivedMeasurementId: nextId("derived"),
    formulaType: hostFormula.formulaType,
    formulaVersion: hostFormula.version,
    inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    supersedesDerivedMeasurementId: hostV1,
    targetId: host.targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: host.targetId,
    createdAt: new Date().toISOString(),
  });

  const openingTargetId = await makeOpeningTarget(host);
  const openingResultId = await makeGmoOpeningResult(openingTargetId);

  // Pinning the now-superseded hostV1 (not its successor) must still succeed —
  // no current-leaf enforcement (FORMULA_AND_DERIVATION_CONTRACT.md's
  // historical/superseded-sources-permitted rule).
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create(
    makeGmoRecord({
      derivedMeasurementId,
      formulaVersion: gmoFormula.version,
      grossSourceDerivedMeasurementId: hostV1,
      inputDerivedMeasurementIds: [openingResultId],
      targetId: host.targetId,
      calculationScope: host.targetId,
      overlapReviewedBy: await makeHumanReviewer(),
      overlapReviewedAt: new Date().toISOString(),
    }),
  );
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.equal(found?.grossSourceDerivedMeasurementId, hostV1);
});

test("GROSS_MINUS_OPENINGS: host + 1 opening without overlap acknowledgement is rejected (2 spatially-relevant inputs)", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: host.targetId,
          // overlapReviewedBy/overlapReviewedAt deliberately omitted.
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: self-supersession composes correctly with host/opening validation", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  const v1Id = nextId("derived");
  await derivedMeasurementRepository.create(
    makeGmoRecord({
      derivedMeasurementId: v1Id,
      formulaVersion: gmoFormula.version,
      grossSourceDerivedMeasurementId,
      inputDerivedMeasurementIds: [openingResultId],
      targetId: host.targetId,
      calculationScope: host.targetId,
      overlapReviewedBy: await makeHumanReviewer(),
      overlapReviewedAt: new Date().toISOString(),
    }),
  );

  // v2 corrects v1 within the same semanticResultKey, reusing the same
  // valid host + opening — the new host/opening validation must run
  // (and pass) exactly as it did for v1, composed with the pre-existing
  // supersession-chain checks (self-ref, predecessor-exists,
  // sameSemanticResultKey, linear-successor).
  const v2Id = nextId("derived");
  await derivedMeasurementRepository.create(
    makeGmoRecord({
      derivedMeasurementId: v2Id,
      formulaVersion: gmoFormula.version,
      grossSourceDerivedMeasurementId,
      inputDerivedMeasurementIds: [openingResultId],
      supersedesDerivedMeasurementId: v1Id,
      targetId: host.targetId,
      calculationScope: host.targetId,
      overlapReviewedBy: await makeHumanReviewer(),
      overlapReviewedAt: new Date().toISOString(),
    }),
  );

  const v2 = await derivedMeasurementRepository.getById(v2Id);
  assert.equal(v2?.supersedesDerivedMeasurementId, v1Id);
  assert.equal(v2?.grossSourceDerivedMeasurementId, grossSourceDerivedMeasurementId);
  assert.deepEqual(v2?.inputDerivedMeasurementIds, [openingResultId]);

  // A second, independent attempt to supersede v1 again must still be
  // rejected — the successor chain remains linear, exactly as for every
  // other formulaType — even though its own host/opening inputs would
  // otherwise be perfectly valid.
  const secondAttemptReviewerId = await makeHumanReviewer();
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          supersedesDerivedMeasurementId: v1Id,
          targetId: host.targetId,
          calculationScope: host.targetId,
          overlapReviewedBy: secondAttemptReviewerId,
          overlapReviewedAt: new Date().toISOString(),
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("GROSS_MINUS_OPENINGS: host SpatialTarget targetType outside {FACADE, ROOF} is rejected", async () => {
  // Since SF-02B, makeFormulaRecord()'s default allowedTargetTypes for
  // GROSS_MINUS_OPENINGS IS the real frozen applicability table
  // (FACADE/ROOF only) — no override needed to prove the actual contract.
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");

  const roomTargetId = nextId("target");
  const buildingId = nextId("building");
  await spatialTargetRepository.create({
    targetId: roomTargetId,
    buildingId,
    targetType: "ROOM",
    replacesTargetIds: [],
    status: "ACTIVE",
  });
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(roomTargetId);

  const openingTargetId = nextId("target");
  await spatialTargetRepository.create({
    targetId: openingTargetId,
    buildingId,
    targetType: "OPENING",
    parentTargetId: roomTargetId,
    replacesTargetIds: [],
    status: "ACTIVE",
  });
  const openingResultId = await makeGmoOpeningResult(openingTargetId);

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: roomTargetId, // ROOM — not FACADE/ROOF
          calculationScope: roomTargetId,
          overlapReviewedBy: nextId("actor"),
          overlapReviewedAt: new Date().toISOString(),
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

// ---------------------------------------------------------------------------
// SF-01 — single-target calculationScope enforcement.
// ---------------------------------------------------------------------------

test("SF-01: single-target formula — calculationScope exactly equal to targetId is accepted", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    calculationScope: targetId,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.equal(found?.calculationScope, targetId);
});

test("SF-01: single-target formula — calculationScope naming a DIFFERENT targetId is rejected", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const otherTargetId = await makeTarget();
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: otherTargetId, // a different, real target's id — still wrong
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("SF-01: single-target formula — arbitrary calculationScope string is rejected", async () => {
  const formula = await makeFormulaDefinition("VOLUME");
  const targetId = await makeTarget();
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "VOLUME",
        semanticCategory: "VOLUME_METRIC",
        calculationScope: "not-a-target-id-at-all",
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("SF-01: single-target formula — composite/multi-target-looking calculationScope is rejected", async () => {
  const formula = await makeFormulaDefinition("POLYLINE_LENGTH");
  const targetId = await makeTarget();
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [{ geometryId: nextId("geometry"), version: 1 }],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "LENGTH",
        semanticCategory: "DEFECT_LENGTH_METRIC",
        // Looks like an aggregate-style composite scope label — still
        // invalid for a single-target formula, no matter its shape.
        calculationScope: `parent:${targetId}+extra`,
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("SF-01: single-target formula — empty calculationScope is rejected", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [nextId("measurement"), nextId("measurement")],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [],
        targetId,
        outputQuantityType: "AREA",
        semanticCategory: "RAW_AREA",
        calculationScope: "",
        createdAt: new Date().toISOString(),
      }),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("SF-01: GROSS_MINUS_OPENINGS (single-target) — calculationScope must equal targetId too", async () => {
  const gmoFormula = await makeFormulaDefinition("GROSS_MINUS_OPENINGS");
  const host = await makeHostTarget("FACADE");
  const grossSourceDerivedMeasurementId = await makeGmoAreaResult(host.targetId);
  const openingResultId = await makeGmoOpeningResult(await makeOpeningTarget(host));

  await assert.rejects(
    () =>
      derivedMeasurementRepository.create(
        makeGmoRecord({
          formulaVersion: gmoFormula.version,
          grossSourceDerivedMeasurementId,
          inputDerivedMeasurementIds: [openingResultId],
          targetId: host.targetId,
          calculationScope: "wrong-scope", // must equal host.targetId
          overlapReviewedBy: nextId("actor"),
          overlapReviewedAt: new Date().toISOString(),
        }),
      ),
    VersionedAppendOnlyRuleViolationError,
  );
});

test("SF-01: aggregate formula behavior is unaffected — AGGREGATE_SUM still canonicalizes a declared label, not a raw targetId", async () => {
  const formula = await makeFormulaDefinition("AGGREGATE_SUM");
  const parentTargetId = nextId("target");
  const declaredScopeLabel = `parent:${parentTargetId}`;
  const source = await makeSourceDerivedMeasurement({ outputQuantityType: "AREA", semanticCategory: "RAW_AREA" });

  const derivedMeasurementId = nextId("derived");
  await derivedMeasurementRepository.create({
    derivedMeasurementId,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [source],
    targetId: parentTargetId,
    outputQuantityType: "AREA",
    semanticCategory: "RAW_AREA",
    // Deliberately NOT equal to parentTargetId — this must still be
    // accepted, because SF-01's exact-equality rule applies only to
    // single-target (non-aggregate) formulas.
    calculationScope: declaredScopeLabel,
    createdAt: new Date().toISOString(),
  });
  const found = await derivedMeasurementRepository.getById(derivedMeasurementId);
  assert.ok(found?.calculationScope.includes(declaredScopeLabel));
});

// ---------------------------------------------------------------------------
// SF-03: overlap reviewer identity validation
// ---------------------------------------------------------------------------

function makeSf03Record(overlapReviewedBy: string, targetId: string, formulaType: string, formulaVersion: number) {
  return {
    derivedMeasurementId: nextId("derived"),
    formulaType: formulaType as Parameters<typeof derivedMeasurementRepository.create>[0]["formulaType"],
    formulaVersion,
    inputMeasurementIds: [nextId("measurement")],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [],
    targetId,
    outputQuantityType: "AREA" as const,
    semanticCategory: "RAW_AREA" as const,
    calculationScope: targetId,
    overlapReviewedBy: overlapReviewedBy as Parameters<typeof derivedMeasurementRepository.create>[0]["overlapReviewedBy"],
    overlapReviewedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

test("SF-03: overlapReviewedBy resolving to an ACTIVE HUMAN_OPERATOR is accepted", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const reviewerId = await makeHumanReviewer();

  const record = makeSf03Record(reviewerId, targetId, formula.formulaType, formula.version);
  await derivedMeasurementRepository.create(record);

  const found = await derivedMeasurementRepository.getById(record.derivedMeasurementId);
  assert.equal(found?.overlapReviewedBy, reviewerId);
});

test("SF-03: overlapReviewedBy naming an unknown actor is rejected with ActorNotFoundError", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const unknownActorId = nextId("actor"); // never seeded into actorRef

  await assert.rejects(
    () => derivedMeasurementRepository.create(makeSf03Record(unknownActorId, targetId, formula.formulaType, formula.version)),
    ActorNotFoundError,
  );
});

test("SF-03: overlapReviewedBy naming an AGENT is rejected with ActorTypeViolationError", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const agentId = await makeAgentReviewer();

  await assert.rejects(
    () => derivedMeasurementRepository.create(makeSf03Record(agentId, targetId, formula.formulaType, formula.version)),
    ActorTypeViolationError,
  );
});

test("SF-03: overlapReviewedBy naming an INACTIVE HUMAN_OPERATOR is rejected with ActorInactiveError", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = await makeTarget();
  const inactiveReviewerId = await makeInactiveHumanReviewer();

  await assert.rejects(
    () => derivedMeasurementRepository.create(makeSf03Record(inactiveReviewerId, targetId, formula.formulaType, formula.version)),
    ActorInactiveError,
  );
});
