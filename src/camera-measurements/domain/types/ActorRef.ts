/**
 * ActorRef — REFERENCE_IDENTITY.
 * Source: docs/architecture/camera-measurements/IDENTITY_AND_ACCOUNTABILITY.md
 */
import type { ActorId } from "../ids/ids.ts";

/**
 * Only two values are frozen. SYSTEM, IMPORT_PROCESS, DEVICE, and
 * ORGANIZATION were explicitly reviewed and excluded — see
 * IDENTITY_AND_ACCOUNTABILITY.md §`actorType` Enum.
 */
export type ActorType = "HUMAN_OPERATOR" | "AGENT";

/** Bidirectional lifecycle flag — never invalidates past references. */
export type ActorStatus = "ACTIVE" | "INACTIVE";

export interface ActorRef {
  /** Stable, non-recyclable domain identity. Immutable. */
  readonly actorId: ActorId;
  /** Set once at creation. Immutable. */
  readonly actorType: ActorType;
  /** Current best-known presentation name. Live/mutable. */
  displayName: string;
  /**
   * Opaque, non-PII pointer to a future external auth/SSO subject.
   * Optional; becomes immutable the instant it is first populated;
   * must be unique across all ActorRef rows when set.
   */
  externalSubjectRef?: string;
  /** Bidirectional (ACTIVE <-> INACTIVE). Restricts only future assignment. */
  status: ActorStatus;
}
