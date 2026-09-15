/**
 * Decision — APPEND_ONLY_FACT repository. The enforcement point of human
 * accountability for AI-originated suggestions.
 */
import type { Decision } from "../../domain/types/Decision.ts";
import type { DecisionId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { assertActorType } from "../guards/actorAccountability.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.decision;
const base = createAppendOnlyRepository<Decision, DecisionId>(table, "decision");

export const decisionRepository = {
  ...base,

  async create(decision: Decision): Promise<DecisionId> {
    // Decision: REQUIRED, HUMAN_OPERATOR only — never AGENT.
    await assertActorType(db.actorRef, decision.actorId, ["HUMAN_OPERATOR"]);

    const proposal = await db.proposal.get(decision.proposalId);
    if (!proposal) {
      throw new ReferenceIdentityRuleViolationError(
        `Decision "${decision.decisionId}": proposalId "${decision.proposalId}" does not exist.`,
      );
    }

    return table.add(decision);
  },
};
