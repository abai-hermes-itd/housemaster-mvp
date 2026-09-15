/**
 * Building — REFERENCE_IDENTITY.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md §Building,
 * PERSISTENCE_AND_IMMUTABILITY.md §Building.
 */
import type { BuildingId } from "../ids/ids.ts";

export interface Building {
  /** Stable, non-recycled. Immutable. The only field carrying reproducibility weight. */
  readonly buildingId: BuildingId;
  /** Descriptive metadata — may be corrected freely; participates in no calculation. */
  name: string;
  /** Descriptive metadata — may be corrected freely; participates in no calculation. */
  address?: string;
}
