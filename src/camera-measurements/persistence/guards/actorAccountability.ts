/**
 * Shared actor-accountability validation used by repositories that must
 * enforce IDENTITY_AND_ACCOUNTABILITY.md's §Action → Actor Requirement
 * table at write time (not merely document it).
 */
import type { Table } from "dexie";
import type { ActorId } from "../../domain/ids/ids.ts";
import type { ActorRef, ActorType } from "../../domain/types/ActorRef.ts";
import { ActorInactiveError, ActorNotFoundError, ActorTypeViolationError } from "./errors.ts";

/**
 * Looks up the given actorId and throws unless it exists, its actorType
 * is one of `allowed`, AND it is currently ACTIVE. Used by
 * CalibrationSession, Measurement, Evidence, and Decision repositories
 * (all REQUIRED: HUMAN_OPERATOR), and by Proposal (REQUIRED:
 * HUMAN_OPERATOR or AGENT).
 *
 * The ACTIVE check enforces IDENTITY_AND_ACCOUNTABILITY.md's own stated
 * purpose for `status`: it "restricts *future* assignment" — i.e. blocks
 * only NEW accountable actions. It does nothing to, and is never
 * consulted for, any record already created while the actor was ACTIVE:
 * this function is called only from *create* paths, never from a read
 * path, so historical rows remain exactly as readable and valid as
 * before the actor became INACTIVE. Reactivating an actor (INACTIVE ->
 * ACTIVE, still the same actorId — see ActorRef repository) simply makes
 * it eligible for new actions again; nothing here rewrites what already
 * happened while it was active.
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
  if (actor.status !== "ACTIVE") {
    throw new ActorInactiveError(actorId);
  }
}
