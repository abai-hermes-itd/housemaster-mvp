/**
 * KnowledgeCitation — APPEND_ONLY_FACT repository. Structurally disjoint
 * from Evidence — never a measurement value.
 */
import type { KnowledgeCitation } from "../../domain/types/KnowledgeCitation.ts";
import type { CitationId } from "../../domain/ids/ids.ts";
import { db } from "../db.ts";
import { createAppendOnlyRepository } from "../guards/appendOnlyRepository.ts";
import { ReferenceIdentityRuleViolationError } from "../guards/errors.ts";

const table = db.knowledgeCitation;
const base = createAppendOnlyRepository<KnowledgeCitation, CitationId>(table, "knowledgeCitation");

export const knowledgeCitationRepository = {
  ...base,

  async create(citation: KnowledgeCitation): Promise<CitationId> {
    if (citation.attachedToType === "PROPOSAL") {
      const proposal = await db.proposal.get(citation.attachedToId);
      if (!proposal) {
        throw new ReferenceIdentityRuleViolationError(
          `KnowledgeCitation "${citation.citationId}": attachedToId "${citation.attachedToId}" (PROPOSAL) does not exist.`,
        );
      }
    } else if (citation.attachedToType === "SPATIAL_TARGET") {
      const target = await db.spatialTarget.get(citation.attachedToId);
      if (!target) {
        throw new ReferenceIdentityRuleViolationError(
          `KnowledgeCitation "${citation.citationId}": attachedToId "${citation.attachedToId}" (SPATIAL_TARGET) does not exist.`,
        );
      }
    }
    // REPORT: Report's own store is out of scope for G1-04 (G1-05+) —
    // the reference is accepted without an existence check for now.

    return table.add(citation);
  },
};
