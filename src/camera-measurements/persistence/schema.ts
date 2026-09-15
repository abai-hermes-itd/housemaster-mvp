/**
 * Camera Measurements — Dexie schema bootstrap (G1-03 scaffold).
 *
 * PLACEHOLDER ONLY. This file intentionally defines no domain entity
 * stores (Building, SpatialTarget, Measurement, Geometry, etc.) — that
 * is out of scope for G1-03 and belongs to a later, explicitly opened
 * G1 move against the frozen architecture in
 * docs/architecture/camera-measurements/.
 *
 * Its only purpose right now is to give `db.ts` a valid, compilable
 * Dexie version definition to call, so the persistence bootstrap
 * type-checks before any entity work begins.
 */
import type Dexie from "dexie";

/** Current schema version number. Bump only when adding real stores. */
export const SCHEMA_VERSION = 1;

/**
 * Applies the current schema version to a Dexie database instance.
 * Version 1 defines zero stores on purpose — see file header.
 */
export function applySchema(db: Dexie): void {
  db.version(SCHEMA_VERSION).stores({});
}
