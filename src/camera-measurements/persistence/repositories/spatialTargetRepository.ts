/**
 * SpatialTarget — REFERENCE_IDENTITY repository.
 *
 * Allows: create (with lineage/containment validation), read, and the one
 * legitimate mutation — retire() — a one-way, terminal ACTIVE -> RETIRED
 * transition. targetType/buildingId/parentTargetId/replacesTargetIds have
 * no update path once created.
 */
import type { SpatialTarget } from "../../domain/types/SpatialTarget.ts";
import type { ActorId, TargetId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.spatialTarget;

/** INVARIANTS.md #7 — containment is acyclic, depth bounded to 3 levels. */
const MAX_CONTAINMENT_DEPTH = 3;

async function containmentDepth(targetId: TargetId): Promise<number> {
  let depth = 1;
  let current = await table.get(targetId);
  while (current?.parentTargetId) {
    depth += 1;
    if (depth > MAX_CONTAINMENT_DEPTH) {
      return depth;
    }
    current = await table.get(current.parentTargetId);
  }
  return depth;
}

export const spatialTargetRepository = {
  async create(target: SpatialTarget): Promise<TargetId> {
    if (target.parentTargetId) {
      const parent = await table.get(target.parentTargetId);
      if (!parent) {
        throw new ReferenceIdentityRuleViolationError(
          `SpatialTarget "${target.targetId}": parentTargetId "${target.parentTargetId}" does not exist.`,
        );
      }
      if (parent.buildingId !== target.buildingId) {
        throw new ReferenceIdentityRuleViolationError(
          `SpatialTarget "${target.targetId}": parentTargetId "${target.parentTargetId}" belongs to a different building.`,
        );
      }
      const parentDepth = await containmentDepth(parent.targetId);
      if (parentDepth + 1 > MAX_CONTAINMENT_DEPTH) {
        throw new ReferenceIdentityRuleViolationError(
          `SpatialTarget "${target.targetId}": containment depth would exceed ${MAX_CONTAINMENT_DEPTH} levels (INVARIANTS.md #7).`,
        );
      }
    }

    for (const predecessorId of target.replacesTargetIds) {
      if (predecessorId === target.targetId) {
        throw new ReferenceIdentityRuleViolationError(
          `SpatialTarget "${target.targetId}": replacesTargetIds cannot contain a self-reference.`,
        );
      }
      const predecessor = await table.get(predecessorId);
      if (!predecessor) {
        throw new ReferenceIdentityRuleViolationError(
          `SpatialTarget "${target.targetId}": replacesTargetIds entry "${predecessorId}" does not exist.`,
        );
      }
      if (predecessor.buildingId !== target.buildingId) {
        throw new ReferenceIdentityRuleViolationError(
          `SpatialTarget "${target.targetId}": replacesTargetIds entry "${predecessorId}" belongs to a different building — cross-building lineage is rejected at write time.`,
        );
      }
      // Requiring the predecessor to already exist guarantees the lineage
      // graph is acyclic by construction: an edge can only ever point at
      // a target created strictly earlier than this one.
    }

    return table.add(target);
  },

  async getById(targetId: TargetId): Promise<SpatialTarget | undefined> {
    return table.get(targetId);
  },

  async list(): Promise<SpatialTarget[]> {
    return table.toArray();
  },

  /**
   * One-way, terminal (no reactivation in MVP). Writes only status,
   * retiredAt, retiredReason, retiredActor — nothing else.
   */
  async retire(
    targetId: TargetId,
    fields: { retiredAt: string; retiredReason: string; retiredActor: ActorId },
  ): Promise<void> {
    const existing = await table.get(targetId);
    if (!existing) {
      throw new Error(`SpatialTarget "${targetId}" was not found.`);
    }
    if (existing.status === "RETIRED") {
      throw new ReferenceIdentityRuleViolationError(
        `SpatialTarget "${targetId}" is already RETIRED — this is a terminal, one-way transition with no reactivation in MVP.`,
      );
    }
    await table.update(targetId, {
      status: "RETIRED",
      retiredAt: fields.retiredAt,
      retiredReason: fields.retiredReason,
      retiredActor: fields.retiredActor,
    });
  },
};
