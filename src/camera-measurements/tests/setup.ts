/**
 * Test-only IndexedDB polyfill.
 *
 * fake-indexeddb is a devDependency ONLY (see package.json). It is
 * imported here, in a file under src/camera-measurements/tests/, and
 * nowhere in persistence/db.ts or any other production source — Node's
 * real runtime for this scaffold still has no IndexedDB, exactly as
 * before; this file exists solely so `npm test` can exercise the real
 * Dexie-backed repositories against something IndexedDB-shaped.
 *
 * Preloaded via `node --import` before any test file (and therefore
 * before persistence/db.ts is ever imported, since db.ts constructs its
 * Dexie instance at module-load time and needs indexedDB/IDBKeyRange to
 * already exist as globals).
 */
import "fake-indexeddb/auto";
