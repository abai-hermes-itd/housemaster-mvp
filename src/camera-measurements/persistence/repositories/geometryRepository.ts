/**
 * Geometry — VERSIONED_APPEND_ONLY repository.
 *
 * "Update"/"delete" are always forbidden (reused from the append-only
 * guard, which fits VERSIONED_APPEND_ONLY exactly as well as
 * APPEND_ONLY_FACT: no row, once written, is ever mutated or removed —
 * only insertion of a new (geometryId, version) row is allowed).
 */
import type { Geometry } from "../../domain/types/Geometry.ts";
import type { GeometryId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { ConcurrencyConflictError, DuplicateVersionError } from "../guards/errors.ts";

const table = db.geometry;
const base = createAppendOnlyRepository<Geometry, [GeometryId, number]>(table, "geometry");

export const geometryRepository = {
  ...base,

  /**
   * Raw insert of one (geometryId, version) row. The compound primary key
   * makes an exact duplicate impossible to insert twice; Dexie's own
   * uniqueness constraint is translated into a named domain error here.
   */
  async create(record: Geometry): Promise<[GeometryId, number]> {
    try {
      return await table.add(record);
    } catch (err) {
      if (err instanceof Error && err.name === "ConstraintError") {
        throw new DuplicateVersionError("Geometry", `${record.geometryId}@v${record.version}`);
      }
      throw err;
    }
  },

  async getVersion(geometryId: GeometryId, version: number): Promise<Geometry | undefined> {
    return table.get([geometryId, version]);
  },

  async listVersions(geometryId: GeometryId): Promise<Geometry[]> {
    return table.where("geometryId").equals(geometryId).sortBy("version");
  },

  /**
   * "Current version" is a derived concept for *new*-work queries only —
   * PERSISTENCE_AND_IMMUTABILITY.md §Geometry. Historical replay must
   * never call this; it must resolve the exact pinned composite instead.
   */
  async getCurrentVersion(geometryId: GeometryId): Promise<Geometry | undefined> {
    const versions = await table.where("geometryId").equals(geometryId).sortBy("version");
    return versions[versions.length - 1];
  },

  /**
   * Atomic compare-and-create: the caller states the version it observed
   * as current (0 if it believes no version exists yet). If the actual
   * current version has since changed, this rejects — the caller must
   * retry against a freshly-read current version. Reading the current
   * max version and inserting the next one happen inside one Dexie
   * (IndexedDB) read-write transaction, which IndexedDB serializes
   * against any other transaction touching the same store, so two
   * concurrent callers can never both succeed in creating the same next
   * version.
   */
  async createNextVersion(
    geometryId: GeometryId,
    expectedCurrentVersion: number,
    fields: Omit<Geometry, "geometryId" | "version">,
  ): Promise<Geometry> {
    return db.transaction("rw", table, async () => {
      const versions = await table.where("geometryId").equals(geometryId).toArray();
      const actualCurrentVersion = versions.length === 0 ? 0 : Math.max(...versions.map((v) => v.version));
      if (actualCurrentVersion !== expectedCurrentVersion) {
        throw new ConcurrencyConflictError("Geometry", geometryId, expectedCurrentVersion, actualCurrentVersion);
      }
      const record: Geometry = { geometryId, version: actualCurrentVersion + 1, ...fields };
      await table.add(record);
      return record;
    });
  },
};
