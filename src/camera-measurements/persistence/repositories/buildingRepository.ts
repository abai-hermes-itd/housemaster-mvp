/**
 * Building — REFERENCE_IDENTITY repository.
 *
 * Allows: create, read, and correcting the mutable descriptive metadata
 * (name/address) only. buildingId is immutable and has no update path.
 */
import type { Building } from "../../domain/types/Building.ts";
import type { BuildingId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";

const table = db.building;

export const buildingRepository = {
  async create(building: Building): Promise<BuildingId> {
    return table.add(building);
  },

  async getById(buildingId: BuildingId): Promise<Building | undefined> {
    return table.get(buildingId);
  },

  async list(): Promise<Building[]> {
    return table.toArray();
  },

  /**
   * The only mutation PERSISTENCE_AND_IMMUTABILITY.md §Building allows:
   * "All descriptive metadata (name, address) may be corrected freely;
   * none of it participates in any calculation." buildingId cannot be
   * targeted by this patch — it is not part of the input type.
   *
   * The allowed fields are picked out explicitly into a fresh object
   * rather than forwarding `patch` itself to Dexie: Dexie's `update()`
   * does NOT strip a primary-key property out of the changes object on
   * its own — a caller that bypasses the TS type (e.g. by spreading a
   * full Building into `patch`) could otherwise smuggle a buildingId
   * change through. This is the runtime enforcement of "buildingId has
   * no update path," not merely a compile-time one.
   */
  async updateDescriptiveMetadata(
    buildingId: BuildingId,
    patch: Partial<Pick<Building, "name" | "address">>,
  ): Promise<void> {
    const existing = await table.get(buildingId);
    if (!existing) {
      throw new Error(`Building "${buildingId}" was not found.`);
    }
    const safePatch: Partial<Pick<Building, "name" | "address">> = {};
    if ("name" in patch) {
      safePatch.name = patch.name;
    }
    if ("address" in patch) {
      safePatch.address = patch.address;
    }
    await table.update(buildingId, safePatch);
  },
};
