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
import {
  ConcurrencyConflictError,
  DuplicateVersionError,
  VersionedAppendOnlyRuleViolationError,
} from "../guards/errors.ts";

const table = db.geometry;
const base = createAppendOnlyRepository<Geometry, [GeometryId, number]>(table, "geometry");

export const geometryRepository = {
  ...base,

  /**
   * Inserts the FIRST version (version 1) of a brand-new geometryId only
   * — G1-05B-R2 finding R2-01: the original `create()` permitted
   * inserting an arbitrary (geometryId, version) pair directly (e.g. a
   * "v3" with no v1/v2 ever created), bypassing the atomic
   * compare-and-create guard entirely. Every version after the first
   * must go through `createNextVersion()`; this method rejects both a
   * non-1 version and any geometryId that already has at least one row.
   * The existence check and the insert happen inside one Dexie
   * transaction so two concurrent `create()` calls for the same
   * brand-new geometryId can't both slip past the existence check (the
   * compound-key uniqueness constraint would also catch that specific
   * case on its own, since both would target the identical
   * `(geometryId, 1)` key, but the transaction removes the race window
   * entirely rather than relying on that as the only backstop).
   */
  async create(record: Geometry): Promise<[GeometryId, number]> {
    if (record.version !== 1) {
      throw new VersionedAppendOnlyRuleViolationError(
        `Geometry "${record.geometryId}": create() may only insert version 1 of a brand-new geometryId — ` +
          `every later version must be created through createNextVersion().`,
      );
    }

    return db.transaction("rw", table, async () => {
      const alreadyHasAVersion = await table.where("geometryId").equals(record.geometryId).count();
      if (alreadyHasAVersion > 0) {
        throw new VersionedAppendOnlyRuleViolationError(
          `Geometry "${record.geometryId}" already has at least one version on record — create() only ` +
            `accepts a brand-new geometryId; use createNextVersion() to add a subsequent version.`,
        );
      }

      try {
        await table.add(record);
      } catch (err) {
        if (err instanceof Error && err.name === "ConstraintError") {
          throw new DuplicateVersionError("Geometry", `${record.geometryId}@v${record.version}`);
        }
        throw err;
      }
      return [record.geometryId, record.version] as [GeometryId, number];
    });
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
