/**
 * Geometry — VERSIONED_APPEND_ONLY.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §Geometry, PERSISTENCE_AND_IMMUTABILITY.md §Geometry.
 */
import type { GeometryId } from "../ids/ids.ts";

/** Primitives: POINT, POLYLINE, POLYGON only — no Plane/Boundary/Surface/DefectGeometry. */
export type GeometryPrimitiveType = "POINT" | "POLYLINE" | "POLYGON";

export interface Geometry {
  /** Stable across versions — one half of the composite identity. Immutable. */
  readonly geometryId: GeometryId;
  /** Immutable, monotonically incrementing per geometryId — the other half of the composite identity. */
  readonly version: number;
  readonly primitiveType: GeometryPrimitiveType;
  /**
   * The captured shape's coordinate data. The frozen docs name the
   * (geometryId, version) identity, full immutability, and the closed
   * primitive-type set explicitly, but do not further specify a payload
   * field/format for the shape itself — this is the minimum structural
   * representation needed to hold *some* captured shape (a POINT is one
   * coordinate tuple, a POLYLINE/POLYGON is an ordered list of them), not
   * an invented business field. See G1-05B report's ARCHITECTURE_GAPS.
   */
  readonly coordinates: readonly (readonly number[])[];
  readonly createdAt: string;
}

/**
 * No `targetId` field is declared here, and none is named for Geometry in
 * DOMAIN_MODEL.md/PERSISTENCE_AND_IMMUTABILITY.md. This mirrors the
 * pattern already established for Measurement ("targetId (implicit via
 * session)"): Geometry's relationship to a SpatialTarget is traceable
 * transitively via whichever Measurement pins this exact (geometryId,
 * version) composite — never duplicated as a second, independently
 * mutable/inconsistent foreign key on Geometry itself. Full traceability
 * (SpatialTarget -> MeasurementSession -> Measurement -> Geometry) is
 * completed once MeasurementSession exists (G1-05C).
 */
