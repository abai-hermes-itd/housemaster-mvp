/**
 * Proposal — APPEND_ONLY_FACT repository. No workflow engine — identity
 * and authorship provenance only.
 */
import type { Proposal } from "../../domain/types/Proposal.ts";
import type { ProposalId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { assertActorType } from "../guards/actorAccountability.ts";

const table = db.proposal;
const base = createAppendOnlyRepository<Proposal, ProposalId>(table, "proposal");

export const proposalRepository = {
  ...base,

  async create(proposal: Proposal): Promise<ProposalId> {
    // Submit Proposal: REQUIRED, HUMAN_OPERATOR or AGENT — the only
    // dual-authorship case in the model.
    await assertActorType(db.actorRef, proposal.authorActorId, ["HUMAN_OPERATOR", "AGENT"]);
    return table.add(proposal);
  },
};
