/**
 * G1-05B — VERSIONED_APPEND_ONLY: Geometry, FormulaDefinition, DerivedMeasurement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { geometryRepository } from "../persistence/repositories/geometryRepository.ts";
import { formulaDefinitionRepository } from "../persistence/repositories/formulaDefinitionRepository.ts";
import { derivedMeasurementRepository } from "../persistence/repositories/derivedMeasurementRepository.ts";
import { canonicalizeAggregateCalculationScope } from "../domain/types/DerivedMeasurement.ts";
import {
  AppendOnlyViolationError,
  ConcurrencyConflictError,
  DuplicateVersionError,
  VersionedAppendOnlyRuleViolationError,
} from "../persistence/guards/errors.ts";
import { nextId } from "./testIds.ts";

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

function makeFormulaRecord(overrides: Partial<Parameters<typeof formulaDefinitionRepository.create>[0]> = {}) {
  return {
    formulaDefinitionId: nextId("formuladef"),
    formulaType: "RECTANGLE_AREA" as const,
    version: 1,
    implementationRef: "impl://rectangle-area/v1",
    implementationHash: "sha256:rect1",
    inputContract: "2 scalar Measurements (length, width)",
    outputQuantityType: "AREA" as const,
    semanticCategory: "RAW_AREA" as const,
    allowedTargetTypes: ["ROOM", "FACADE"] as const,
    requiredGeometryType: "NONE" as const,
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

test("FormulaDefinition: repository update rejects, repository delete rejects", async () => {
  const record = makeFormulaRecord({ formulaType: "DEFECT_LENGTH_TOTAL" });
  await formulaDefinitionRepository.create(record);
  await assert.rejects(
    () => formulaDefinitionRepository.update([record.formulaType, 1], { implementationHash: "tampered" }),
    AppendOnlyViolationError,
  );
  await assert.rejects(() => formulaDefinitionRepository.delete([record.formulaType, 1]), AppendOnlyViolationError);
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

test("DerivedMeasurement: create initial version", async () => {
  const formula = await makeFormulaDefinition("RECTANGLE_AREA");
  const targetId = nextId("target");
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
  const targetId = nextId("target");
  const geometryId = nextId("geometry");
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
  const targetId = nextId("target");
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
  const targetId = nextId("target");
  const record = {
    derivedMeasurementId: nextId("derived"),
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [{ geometryId: nextId("geometry"), version: 1 }],
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
  const targetId = nextId("target");
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
  const sourceDerivedIds = [nextId("derived"), nextId("derived"), nextId("derived")];
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
    overlapReviewedBy: nextId("actor"),
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
  const targetId = nextId("target");
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
    inputDerivedMeasurementIds: [nextId("derived")],
    targetId,
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    calculationScope: targetId,
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
        inputDerivedMeasurementIds: [nextId("derived")],
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
  const targetId = nextId("target");
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
  const targetId = nextId("target");
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
  const targetId = nextId("target");
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
  await derivedMeasurementRepository.create({
    derivedMeasurementId: nextId("derived"),
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [nextId("derived")],
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
  const inputDerivedMeasurementIds = [nextId("derived"), nextId("derived")];
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
  const sourceA = nextId("derived");
  const sourceB = nextId("derived");

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
  await derivedMeasurementRepository.create({
    derivedMeasurementId: v1Id,
    formulaType: formula.formulaType,
    formulaVersion: formula.version,
    inputMeasurementIds: [],
    inputGeometryRefs: [],
    inputDerivedMeasurementIds: [nextId("derived")],
    targetId: parentTargetId,
    outputQuantityType: "LENGTH",
    semanticCategory: "DEFECT_LENGTH_METRIC",
    calculationScope: declaredScopeLabel,
    createdAt: new Date().toISOString(),
  });

  // Same declared label, but a genuinely different resolved input set —
  // per the frozen text, this must NOT compare as the same
  // semanticResultKey, even though the label alone matches.
  await assert.rejects(
    () =>
      derivedMeasurementRepository.create({
        derivedMeasurementId: nextId("derived"),
        formulaType: formula.formulaType,
        formulaVersion: formula.version,
        inputMeasurementIds: [],
        inputGeometryRefs: [],
        inputDerivedMeasurementIds: [nextId("a-completely-different-source-derived")],
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
