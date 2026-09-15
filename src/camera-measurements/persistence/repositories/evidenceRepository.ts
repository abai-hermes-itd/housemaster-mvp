/**
 * Evidence — APPEND_ONLY_FACT repository. Immutable/verifiable payload
 * reference only — no file storage backend is implemented here.
 */
import type { Evidence } from "../../domain/types/Evidence.ts";
import type { EvidenceId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.evidence;
const base = createAppendOnlyRepository<Evidence, EvidenceId>(table, "evidence");

export const evidenceRepository = {
  ...base,

  async create(evidence: Evidence): Promise<EvidenceId> {
    // Create Evidence: REQUIRED, HUMAN_OPERATOR (never AGENT).
    await assertActorType(db.actorRef, evidence.actorId, ["HUMAN_OPERATOR"]);

    if (evidence.acceptingDecisionId) {
      const decision = await db.decision.get(evidence.acceptingDecisionId);
      if (!decision) {
        throw new ReferenceIdentityRuleViolationError(
          `Evidence "${evidence.evidenceId}": acceptingDecisionId "${evidence.acceptingDecisionId}" does not exist.`,
        );
      }
      if (decision.outcome !== "ACCEPTED") {
        throw new ReferenceIdentityRuleViolationError(
          `Evidence "${evidence.evidenceId}": acceptingDecisionId must reference an ACCEPTED Decision.`,
        );
      }
    }

    return table.add(evidence);
  },
};
