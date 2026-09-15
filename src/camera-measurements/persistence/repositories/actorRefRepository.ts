/**
 * ActorRef — REFERENCE_IDENTITY repository.
 *
 * Allows: create, read, live displayName correction, bidirectional
 * ACTIVE<->INACTIVE status, and a one-time externalSubjectRef assignment.
 * actorId/actorType have no update path — immutable from creation.
 */
import type { ActorRef, ActorStatus } from "../../domain/types/ActorRef.ts";
import type { ActorId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.actorRef;

export const actorRefRepository = {
  async create(actor: ActorRef): Promise<ActorId> {
    return table.add(actor);
  },

  async getById(actorId: ActorId): Promise<ActorRef | undefined> {
    return table.get(actorId);
  },

  async list(): Promise<ActorRef[]> {
    return table.toArray();
  },

  async updateDisplayName(actorId: ActorId, displayName: string): Promise<void> {
    const existing = await table.get(actorId);
    if (!existing) {
      throw new Error(`ActorRef "${actorId}" was not found.`);
    }
    await table.update(actorId, { displayName });
  },

  /** ACTIVE <-> INACTIVE, bidirectional. Never invalidates past references. */
  async setStatus(actorId: ActorId, status: ActorStatus): Promise<void> {
    const existing = await table.get(actorId);
    if (!existing) {
      throw new Error(`ActorRef "${actorId}" was not found.`);
    }
    await table.update(actorId, { status });
  },

  /**
   * Becomes immutable the instant it is first populated (no relinking in
   * MVP). Global uniqueness across all ActorRef rows is additionally
   * enforced by the underlying Dexie unique index on this field.
   */
  async setExternalSubjectRef(actorId: ActorId, externalSubjectRef: string): Promise<void> {
    const existing = await table.get(actorId);
    if (!existing) {
      throw new Error(`ActorRef "${actorId}" was not found.`);
    }
    if (existing.externalSubjectRef !== undefined) {
      throw new ReferenceIdentityRuleViolationError(
        `ActorRef "${actorId}" already has an externalSubjectRef — it becomes immutable ` +
          `the instant it is first populated (no relinking in MVP).`,
      );
    }
    await table.update(actorId, { externalSubjectRef });
  },
};
