/**
 * Shared actor-accountability validation used by repositories that must
 * enforce IDENTITY_AND_ACCOUNTABILITY.md's §Action → Actor Requirement
 * table at write time (not merely document it).
 */
import type { Table } from "dexie";
import type { ActorId } from "../../domain/ids/ids.ts";
import type { ActorRef, ActorType } from "../../domain/types/ActorRef.ts";
import { ActorNotFoundError, ActorTypeViolationError } from "./errors.ts";

/**
 * Looks up the given actorId and throws unless it exists and its
 * actorType is one of `allowed`. Used by CalibrationSession, Measurement,
 * Evidence, and Decision repositories (all REQUIRED: HUMAN_OPERATOR), and
 * by Proposal (REQUIRED: HUMAN_OPERATOR or AGENT).
 */
export async function assertActorType(
  // See appendOnlyRepository.ts for why the insert-type generic is `any`.
  actorTable: Table<ActorRef, ActorId, any>,
  actorId: ActorId,
  allowed: readonly ActorType[],
): Promise<void> {
  const actor = await actorTable.get(actorId);
  if (!actor) {
    throw new ActorNotFoundError(actorId);
  }
  if (!allowed.includes(actor.actorType)) {
    throw new ActorTypeViolationError(actorId, allowed.join(" or "), actor.actorType);
  }
}
