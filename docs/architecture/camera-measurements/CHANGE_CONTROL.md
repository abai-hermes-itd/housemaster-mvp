# Change Control — Camera Measurements Frozen Architecture

This document governs how, and under what conditions, anything in this canonical document set may ever be changed. It is itself part of the frozen architecture — amending it follows the same process it describes.

## The Baseline

The current frozen baseline is: Math/Topology v0.2 MVP, HG-1, HG-2, HG-3, HG-4 — each closed via Human Freeze, each preceded by an independent Codex adversarial review and, where Codex found material issues, a narrow correction pass addressing only those specific findings. This document set (produced at HG-5) is a **faithful consolidation** of that baseline into the repository — it does not introduce new decisions.

## No Casual Architecture Edits

The following are **never** sufficient grounds to change any entity, field, rule, or invariant in this document set:

- A simplification that would make an implementation marginally easier.
- An aesthetic or naming-consistency preference between two entities' patterns.
- A desire for "completeness" (a field or entity added because it *might* be useful later, without a demonstrated MVP need).
- An implementation team's discovery that a rule is inconvenient to build against.
- A stakeholder request that does not identify a specific, concrete failure mode.

Every prior gate in this chain (see `README.md`) enforced this discipline on itself — every correction pass in HG-1 through HG-4 was scoped to only the specific items an adversarial review had proven material, never to a broader redesign. That discipline is what this document codifies going forward.

## What Justifies a Change

A change requires a **proven blocking contradiction** — a concrete, demonstrated failure mode showing that the current frozen rule would (not merely could, in the abstract) cause one of:

- data corruption,
- identity break,
- mathematical ambiguity or wrong results,
- an unsafe trust boundary (Knowledge, AI/Guide, or otherwise),
- a report-reproducibility failure,
- loss of provenance,
- or an expensive/destructive migration that a minimum architectural correction could have avoided.

A change may also be justified by a genuinely new MVP requirement not covered by the current scope — but this still goes through the full process below; it is not a shortcut.

## Required Process

1. **Identify the specific blocking contradiction** or new requirement, citing the exact document/section/invariant affected.
2. **Open a bounded review gate** scoped only to that item — not a general reopening of the surrounding document.
3. **Independent (Codex) review** of the proposed correction, adversarial in the same style as every prior gate's Codex pass: attacking the proposal for regressions, over-reach, and unintended consequences, not merely rubber-stamping it.
4. **Astra adversarial review** for any high-risk change — one touching more than one document, an invariant in `INVARIANTS.md`, or the entity set itself.
5. **Architect synthesis** — reconciling the proposal against every finding from steps 3–4 into a single, minimal correction.
6. **Human Freeze** — the change is not in effect until explicitly frozen by a human, exactly as HG-1 through HG-4 each required.

No step may be skipped. No change takes effect on an "in progress" or "review complete" status — only on Human Freeze.

## Constraints on Every Correction

- **Scope creep is prohibited.** A correction pass addresses only the items an adversarial review has proven material — nothing else, even if other improvements suggest themselves along the way. Every fix pass in this chain (HG-2-FIX, HG-3-FIX, HG-4-FIX) held to this discipline; future ones must too.
- **No frozen gate is reopened without evidence.** "Reopening" means overturning an explicit prior decision. Completing an under-specified prior concept (as HG-4 did for `DerivedMeasurement.semanticResultKey`, extending HG-2's own `semanticCategory`) or reverting an unauthorized drift back to what was already frozen (as HG-4-FIX did for Geometry's identity model) is not reopening — it is compliance. The distinction matters and must be stated explicitly in any correction's writeup.
- **Implementation findings do not automatically rewrite architecture.** A bug, a performance problem, or an awkward API discovered during implementation is first evaluated against this document set: is the *architecture* wrong, or does the implementation simply need to conform to it correctly? Only the former justifies invoking this process.
- **Entity count changes are treated with the highest scrutiny.** Every gate from R3A onward has held the entity count at 16 core + `ActorRef` (17 total) precisely because every subsequent review found it sufficient when correctly specified at the field/rule level. Proposing a new entity requires demonstrating that no combination of field-level correction on an existing entity can resolve the identified contradiction — the bar met by, for example, rejecting a new `IMPORT_PROCESS` entity in favor of attributing imports to the triggering `HUMAN_OPERATOR`.

## Document Maintenance (Non-Substantive)

Fixing a typo, a broken cross-reference, or formatting within this document set — with no change to any rule, field, entity, or invariant — does not require the process above. If there is any doubt whether a proposed edit is substantive, treat it as substantive and follow the process.
