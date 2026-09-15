/**
 * KnowledgeCitation — APPEND_ONLY_FACT. A pointer to knowledge/
 * regulatory/RAG context — structurally disjoint from Evidence, never a
 * measurement value. Immutable from creation.
 * Source: docs/architecture/camera-measurements/DOMAIN_MODEL.md
 * §KnowledgeCitation, INVARIANTS.md #11.
 */
import type { CitationId, ProposalId, TargetId } from "../ids/ids.ts";

/**
 * Per HG-3-CODEX's broadening: a citation may attach to a Proposal, or
 * (for direct human-authored citation) to a Report or SpatialTarget.
 * Report's own store is out of scope for G1-04; the id is still a plain
 * string reference so this documented relationship isn't dropped.
 */
export type CitationAttachmentType = "PROPOSAL" | "REPORT" | "SPATIAL_TARGET";

export interface KnowledgeCitation {
  readonly citationId: CitationId;
  readonly attachedToType: CitationAttachmentType;
  readonly attachedToId: ProposalId | TargetId | string;
  readonly sourceRef: string;
  /** The retrieved text, frozen verbatim — regardless of later changes to the live source. */
  readonly snippet: string;
  readonly retrievedAt: string;
}
