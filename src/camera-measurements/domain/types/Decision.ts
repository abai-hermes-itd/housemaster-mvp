/**
 * Decision — APPEND_ONLY_FACT. The audit record of a human accepting or
 * rejecting a Proposal — the enforcement point of human accountability
 * for AI-originated suggestions. Immutable from creation, no exception.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md §Decision,
 * IDENTITY_AND_ACCOUNTABILITY.md §Provenance chain.
 */
import type { ActorId, DecisionId, ProposalId } from "../ids/ids.ts";

/**
 * "the audit record of a human accepting or rejecting a Proposal" —
 * DOMAIN_MODEL.md §Decision. This is the minimum field needed to record
 * which of the two a Decision represents.
 */
export type DecisionOutcome = "ACCEPTED" | "REJECTED";

export interface Decision {
  readonly decisionId: DecisionId;
  /** The proposal decided on. */
  readonly proposalId: ProposalId;
  /** Required. Must be HUMAN_OPERATOR — never AGENT. */
  readonly actorId: ActorId;
  readonly outcome: DecisionOutcome;
  readonly createdAt: string;
}
