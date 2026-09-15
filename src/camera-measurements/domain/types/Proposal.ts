/**
 * Proposal — APPEND_ONLY_FACT. A suggested change that is never itself
 * authoritative. Immutable from creation, no exception, before or after
 * any Decision. A revised suggestion is a new Proposal, not an edit.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md §Proposal,
 * IDENTITY_AND_ACCOUNTABILITY.md.
 *
 * No proposal content/payload field is modeled here — the frozen
 * architecture docs do not name one (Proposal's substantive content is a
 * product/Guide-layer concern outside this MVP architecture's boundary;
 * see README.md scope note on the Guide/AI proposal-and-decision
 * boundary). Only identity and authorship provenance are in scope here.
 */
import type { ActorId, ProposalId } from "../ids/ids.ts";

export interface Proposal {
  readonly proposalId: ProposalId;
  /** HUMAN_OPERATOR or AGENT — the only dual-authorship case in the model. */
  readonly authorActorId: ActorId;
  readonly createdAt: string;
}
