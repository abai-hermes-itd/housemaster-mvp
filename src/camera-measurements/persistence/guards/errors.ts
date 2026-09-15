/**
 * Shared error types for the persistence/repository boundary. Distinct
 * classes so callers (and tests) can assert on failure *kind*, not just
 * message text.
 */

/** Thrown when code attempts to update or delete an APPEND_ONLY_FACT row. */
export class AppendOnlyViolationError extends Error {
  constructor(storeName: string, operation: "update" | "delete") {
    super(
      `APPEND_ONLY_VIOLATION: ${operation} is forbidden on "${storeName}" — ` +
        `this entity is append-only per PERSISTENCE_AND_IMMUTABILITY.md. ` +
        `Corrections/supersessions must create a new row instead.`,
    );
    this.name = "AppendOnlyViolationError";
  }
}

/** Thrown when a referenced ActorRef row does not exist. */
export class ActorNotFoundError extends Error {
  constructor(actorId: string) {
    super(`ActorRef "${actorId}" was not found.`);
    this.name = "ActorNotFoundError";
  }
}

/**
 * Thrown when an action requires an actorType the referenced ActorRef
 * does not have — e.g. a Decision authored by an AGENT — per
 * IDENTITY_AND_ACCOUNTABILITY.md §Action → Actor Requirement.
 */
export class ActorTypeViolationError extends Error {
  constructor(actorId: string, required: string, actual: string) {
    super(
      `Actor "${actorId}" has actorType "${actual}", but this action requires "${required}" — ` +
        `see IDENTITY_AND_ACCOUNTABILITY.md §Action → Actor Requirement.`,
    );
    this.name = "ActorTypeViolationError";
  }
}

/** Thrown when a mutation attempts to leave a REFERENCE_IDENTITY row in a forbidden state. */
export class ReferenceIdentityRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceIdentityRuleViolationError";
  }
}
