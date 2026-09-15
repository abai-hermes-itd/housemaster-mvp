/**
 * SpatialTarget — REFERENCE_IDENTITY.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md §SpatialTarget,
 * PERSISTENCE_AND_IMMUTABILITY.md §SpatialTarget, INVARIANTS.md #7/#16.
 */
import type { ActorId, BuildingId, TargetId } from "../ids/ids.ts";

/** Flat, closed enum — no housing-stock ontology is modeled. */
export type TargetType =
  | "ROOM"
  | "BASEMENT_TECH"
  | "FACADE"
  | "ROOF"
  | "ATTIC"
  | "STAIR_AREA"
  | "OPENING"
  | "APARTMENT_UNIT"
  | "DEFECT_AREA"
  | "DEFECT_LINEAR";

/**
 * Derived from targetType — never stored, never overridable. The exact
 * per-targetType mapping lives in the HG-1 per-type table referenced by
 * DOMAIN_MODEL.md but not reproduced in this document set, so no
 * derivation function is implemented here — only the "never stored"
 * persistence rule is in scope for G1-04. This type exists so a future
 * derivation function (wherever the per-type table becomes available)
 * has a name to return, without this persistence layer inventing the
 * mapping itself.
 */
export type AggregationRole = "ADDITIVE_SPATIAL" | "SUBTRACTIVE_FEATURE" | "NON_AGGREGATING";

/** One-way, terminal transition (no reactivation in MVP). */
export type SpatialTargetStatus = "ACTIVE" | "RETIRED";

export interface SpatialTarget {
  /** Stable, non-recycled, immutable from creation, forever. */
  readonly targetId: TargetId;
  /** Immutable from creation. */
  readonly buildingId: BuildingId;
  /** Immutable from creation. */
  readonly targetType: TargetType;
  /**
   * Optional or required depending on targetType. Never mutates in place —
   * a wrong-parent case requires retire + create-new + lineage, so this
   * field is set once at creation and carries no update path.
   */
  readonly parentTargetId?: TargetId;
  /**
   * Written only on the new SpatialTarget, once, at its own creation. May
   * hold more than one entry (split/merge). Every entry must reference a
   * different target within the same buildingId — rejected at write time
   * otherwise. Never edited once written.
   */
  readonly replacesTargetIds: readonly TargetId[];
  /** The one legitimately mutable field: one-way, terminal. */
  status: SpatialTargetStatus;
  /** Written only, atomically, at the single retirement event. */
  retiredAt?: string;
  retiredReason?: string;
  retiredActor?: ActorId;
}
