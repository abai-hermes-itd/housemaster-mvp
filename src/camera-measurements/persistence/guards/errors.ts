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

/**
 * Thrown when an actor is a valid, correctly-typed candidate but is
 * currently INACTIVE — IDENTITY_AND_ACCOUNTABILITY.md's `status` lifecycle
 * flag "restricts *future* assignment" only. A dedicated error type (not
 * ActorTypeViolationError) so a caller/test can tell "wrong kind of actor"
 * apart from "right kind of actor, just not currently eligible" — the two
 * are different frozen rules with different remedies.
 */
export class ActorInactiveError extends Error {
  constructor(actorId: string) {
    super(
      `Actor "${actorId}" is INACTIVE and cannot be used for a new accountable action — ` +
        `see IDENTITY_AND_ACCOUNTABILITY.md §ActorRef ("status" restricts future assignment only; ` +
        `it never invalidates past references).`,
    );
    this.name = "ActorInactiveError";
  }
}

/** Thrown when a mutation attempts to leave a REFERENCE_IDENTITY row in a forbidden state. */
export class ReferenceIdentityRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceIdentityRuleViolationError";
  }
}

/**
 * Thrown when a VERSIONED_APPEND_ONLY entity's exact (id, version) or
 * (type, version) composite identity already exists — PERSISTENCE_AND_
 * IMMUTABILITY.md requires this pair be enforced unique. Distinct from
 * ConcurrencyConflictError: this is "you asked to create a version that
 * is already on record," not "your basis for computing the next version
 * went stale."
 */
export class DuplicateVersionError extends Error {
  constructor(entityLabel: string, identity: string) {
    super(
      `${entityLabel} version "${identity}" already exists — the (id, version) pair is enforced unique ` +
        `per PERSISTENCE_AND_IMMUTABILITY.md; a correction must use the next version number instead.`,
    );
    this.name = "DuplicateVersionError";
  }
}

/**
 * Thrown by an atomic compare-and-create "next version" write when the
 * caller's expected-current-version no longer matches the actual current
 * version — PERSISTENCE_AND_IMMUTABILITY.md §Geometry's optimistic-
 * concurrency guard: "two concurrent correction attempts can never both
 * succeed... the losing attempt must retry against a freshly-read
 * current version."
 */
export class ConcurrencyConflictError extends Error {
  constructor(entityLabel: string, id: string, expectedCurrentVersion: number, actualCurrentVersion: number) {
    super(
      `${entityLabel} "${id}": expected current version ${expectedCurrentVersion}, but the actual current ` +
        `version is ${actualCurrentVersion} — a concurrent write already advanced it; retry against the ` +
        `freshly-read current version.`,
    );
    this.name = "ConcurrencyConflictError";
  }
}

/**
 * Thrown when a mutation attempts to leave a MUTABLE_OPERATIONAL_STATE
 * row in a forbidden state — e.g. reassigning or closing a
 * SurveyAssignment outside its frozen lifecycle rules (HD-01/HD-01A).
 * One shared class for this persistence class, consistent with
 * ReferenceIdentityRuleViolationError (REFERENCE_IDENTITY) and
 * VersionedAppendOnlyRuleViolationError (VERSIONED_APPEND_ONLY) above.
 */
export class MutableOperationalStateRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutableOperationalStateRuleViolationError";
  }
}

/**
 * Thrown when a VERSIONED_APPEND_ONLY entity's lineage/reference rules
 * are violated at write time: a missing predecessor, a branching
 * successor (more than one row claiming the same predecessor), a
 * self-referential predecessor (cycle), an out-of-contract enum value
 * (e.g. formulaType), or a supersession attempted across a different
 * semanticResultKey. One shared class across Geometry/FormulaDefinition/
 * DerivedMeasurement, mirroring how ReferenceIdentityRuleViolationError
 * is shared across the REFERENCE_IDENTITY entities.
 */
export class VersionedAppendOnlyRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionedAppendOnlyRuleViolationError";
  }
}
