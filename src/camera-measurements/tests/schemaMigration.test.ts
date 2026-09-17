/**
 * MIG-01B — coordinated v4 schema structural migration tests.
 *
 * Verifies the physical Dexie schema only: version number, store
 * existence, upgrade safety, and reopen idempotency. Deliberately does
 * NOT test any G1-05C entity's business rules (create/reassign/close
 * etc.) — no repository exists yet for any of the 5 new stores; those
 * rules belong to each entity's own future test file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Dexie from "dexie";
import { db } from "../persistence/db.ts";
import { applySchema, VERSION_2_STORES, VERSION_3_STORES } from "../persistence/schema.ts";
import { buildingRepository } from "../persistence/repositories/buildingRepository.ts";
import { nextId } from "./testIds.ts";

const V2_STORE_NAMES = Object.keys(VERSION_2_STORES);
const V3_ONLY_STORE_NAMES = ["geometry", "formulaDefinition", "derivedMeasurement"];
const V4_ONLY_STORE_NAMES = ["surveyAssignment", "scopeItem", "measurementSession", "report", "reportSnapshot"];
const ALL_EXPECTED_STORE_NAMES = [...V2_STORE_NAMES, ...V3_ONLY_STORE_NAMES, ...V4_ONLY_STORE_NAMES];

test("schema v4: fresh open resolves to version 4", async () => {
  await db.open();
  assert.equal(db.verno, 4);
});

test("schema v4: all pre-existing v2/v3 stores still exist, unchanged", async () => {
  const names = db.tables.map((t) => t.name);
  for (const name of [...V2_STORE_NAMES, ...V3_ONLY_STORE_NAMES]) {
    assert.ok(names.includes(name), `expected pre-existing store "${name}" to still exist`);
  }
});

test("schema v4: all 5 new G1-05C stores exist", async () => {
  const names = db.tables.map((t) => t.name);
  for (const name of V4_ONLY_STORE_NAMES) {
    assert.ok(names.includes(name), `expected new v4 store "${name}" to exist`);
  }
});

test("schema v4: no partial store set — exactly the full expected store set exists, nothing more, nothing less", () => {
  const names = db.tables.map((t) => t.name).sort();
  assert.deepEqual(names, [...ALL_EXPECTED_STORE_NAMES].sort());
});

test("schema v4: a v2/v3-shaped record remains fully readable and writable", async () => {
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "Pre-v4-shaped row" });
  const found = await buildingRepository.getById(buildingId);
  assert.equal(found?.buildingId, buildingId);
  assert.equal(found?.name, "Pre-v4-shaped row");
});

test("schema v4: repeated close/reopen is safe and idempotent", async () => {
  await db.close();
  await db.open();
  assert.equal(db.verno, 4);
  const names = db.tables.map((t) => t.name);
  assert.ok(names.includes("surveyAssignment"));

  // A second, independent repository call after reopen still works —
  // no duplicate-version error, no stale-connection error.
  const buildingId = nextId("building");
  await buildingRepository.create({ buildingId, name: "Reopen check" });
  const found = await buildingRepository.getById(buildingId);
  assert.equal(found?.name, "Reopen check");
});

test("schema v4: a genuine v3-origin database upgrades to v4 with zero data loss and zero transform", async () => {
  // Fully isolated from the shared `db` singleton and its DATABASE_NAME —
  // a distinct database name, so this test can neither read nor pollute
  // any other test file's data in this shared-process test run.
  const isolatedDbName = `housemaster-camera-measurements-mig01b-${nextId("dbname")}`;

  // Step 1 — construct a database that has only ever seen v2 and v3,
  // reusing the real, exported v2/v3 store definitions (not a hand
  // duplicate) so this genuinely reproduces production's pre-v4 shape.
  const v3Only = new Dexie(isolatedDbName);
  v3Only.version(2).stores(VERSION_2_STORES);
  v3Only.version(3).stores(VERSION_3_STORES);
  await v3Only.open();
  assert.equal(v3Only.verno, 3);

  const buildingId = nextId("building");
  const buildingRow = { buildingId, name: "Real pre-v4 building" };
  await v3Only.table("building").add(buildingRow);
  const preUpgradeCount = await v3Only.table("building").count();
  await v3Only.close();

  // Step 2 — reopen the SAME database name through the real, production
  // applySchema (v2 -> v3 -> v4) and confirm the row survived untouched
  // and all 5 new stores now exist alongside it.
  const upgraded = new Dexie(isolatedDbName);
  applySchema(upgraded);
  await upgraded.open();
  assert.equal(upgraded.verno, 4);

  const namesAfterUpgrade = upgraded.tables.map((t) => t.name);
  for (const name of V4_ONLY_STORE_NAMES) {
    assert.ok(namesAfterUpgrade.includes(name), `expected new v4 store "${name}" after upgrade`);
  }

  const postUpgradeCount = await upgraded.table("building").count();
  assert.equal(postUpgradeCount, preUpgradeCount, "row count for a pre-existing store must be unchanged by the upgrade");
  const survivedRow = await upgraded.table("building").get(buildingId);
  assert.deepEqual(survivedRow, buildingRow, "the pre-v4 row's content must be byte-identical after upgrade — no reinterpretation");

  await upgraded.close();
  await Dexie.delete(isolatedDbName);
});
