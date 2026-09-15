/**
 * Camera Measurements — Dexie database shell (G1-03 scaffold).
 *
 * PLACEHOLDER ONLY. No domain entities or object stores are defined
 * here. This exists solely so later G1 moves have a single, typed
 * Dexie database instance to attach real stores/repositories to,
 * without redesigning anything already frozen in
 * docs/architecture/camera-measurements/.
 */
import Dexie from "dexie";
import { applySchema } from "./schema";

/** IndexedDB database name for the Camera Measurements feature. */
export const DATABASE_NAME = "housemaster-camera-measurements";

/**
 * The Camera Measurements Dexie database instance.
 *
 * Built via direct instantiation (Dexie's documented v4 pattern for a
 * database with no typed tables yet) rather than class subclassing,
 * to avoid Dexie 4's known TS2589 "excessively deep" instantiation
 * error when a Dexie subclass declares zero table properties.
 *
 * Intentionally has no typed table properties yet — those are added
 * only once the corresponding entity's persistence classification
 * (APPEND_ONLY_FACT / VERSIONED_APPEND_ONLY / MUTABLE_OPERATIONAL_STATE /
 * IMMUTABLE_SNAPSHOT / REFERENCE_IDENTITY) is implemented in a later,
 * explicitly opened G1 move.
 */
export const db: Dexie = new Dexie(DATABASE_NAME);

applySchema(db);
