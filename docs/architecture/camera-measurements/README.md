# Camera Measurements — Canonical Architecture (MVP)

**Status: FROZEN.** This document set is the authoritative, consolidated record of the Math/Topology v0.2 MVP architecture for HouseMaster's Camera Measurements feature, as closed through Human Freeze gates HG-1 through HG-4. It exists because the review chain that produced this architecture (CM-S13-CM-R3A/R3B → CM-S13-C3 → GATE-0A/HG-1 → GATE-0B/HG-2 → GATE-0C/HG-3 → GATE-0D/HG-4, each with an independent Codex adversarial pass and a narrow-fix pass) previously existed only as conversation transcripts, not as committed repository artifacts — a gap identified and flagged as a pre-build blocker at every prior gate. This document set closes that gap.

## Purpose

Camera Measurements lets a field operator capture, calculate, and report physical building measurements — room/facade/roof areas, volumes, openings, and defects — using either manual entry or camera-assisted capture, while guaranteeing:

- physical-object identity survives repeat surveys,
- raw measurements, derived calculations, and reported values are never conflated,
- every issued report remains exactly reproducible forever,
- an AI/Guide system can suggest but never silently authorize authoritative change,
- knowledge/RAG context never becomes measurement evidence.

These guarantees are the actual point of the architecture. Every entity, field, and rule in this document set exists to serve one or more of them — see `INVARIANTS.md` for the canonical, numbered list.

## Frozen Status

| Gate | Subject | Status |
|---|---|---|
| Math/Topology v0.2 MVP | Overall entity/relationship reduction | FROZEN |
| HG-1 | `targetType`, `aggregationRole`, `SpatialTarget` lineage/containment | HUMAN FROZEN / CLOSED |
| HG-2 | `formulaType` catalogue, compatibility, `DerivedMeasurement` semantics | HUMAN FROZEN / CLOSED |
| HG-3 | `ActorRef`, human accountability, `Decision` provenance | HUMAN FROZEN / CLOSED |
| HG-4 | Append-only / persistence / historical replay / immutability | HUMAN FROZEN / CLOSED |
| HG-5 (this gate) | Canonical documentation of the above | IN PROGRESS |

Each gate above passed through: an architect proposal → an independent Codex adversarial review → a narrow correction pass addressing only Codex's findings → human freeze. No entity was added or removed at any correction pass; every correction was a field-level rule refinement. That discipline is itself part of what is frozen — see `CHANGE_CONTROL.md`.

## Scope

**In scope (MVP):** the 16 core entities below, manual and camera-assisted measurement capture, the 8 frozen calculation formulas, report issuance and one-way withdrawal, a minimal Guide/AI proposal-and-decision boundary, and the minimum actor-identity model needed for accountability.

**Out of scope (deferred to a future platform track, not designed here):** full IAM/SSO, organization/tenancy modeling, the full housing-stock topology ontology, a full Knowledge/RAG governance layer, document-management/workflow features beyond issuance and withdrawal, and a Product MCP/API surface (though this architecture is designed not to create incompatibilities with one — see the API/MCP compatibility notes in each document).

## The 16 MVP Core Entities

```
Building · SpatialTarget · SurveyAssignment · ScopeItem · MeasurementSession
CalibrationSession · Measurement · Geometry · FormulaDefinition · DerivedMeasurement
Evidence · Report · ReportSnapshot · Proposal · Decision · KnowledgeCitation
```

Plus **`ActorRef`** — a supporting identity/reference model (not one of the 16 core measurement/topology entities, but required by nearly every one of them for provenance and accountability).

Full definitions, relationships, and per-entity rules: `DOMAIN_MODEL.md`.

## How HG-1 Through HG-4 Relate

- **HG-1** froze *what a physical measurement subject is*: the `SpatialTarget` identity model, its `targetType`/`aggregationRole` classification, and containment rules.
- **HG-2** froze *how a value is calculated from a target's geometry*: the closed `formulaType` catalogue, its compatibility with target types and geometry kinds, and how a `DerivedMeasurement` is produced and remains reproducible.
- **HG-3** froze *who is accountable for a change*: the `ActorRef` identity model and the human-accountability boundary around every authoritative write, including the AI/Guide proposal-and-decision mechanism.
- **HG-4** froze *how history is protected*: which entities may never be mutated once written, which may hold legitimate operational state, and the exact mechanism (new row + forward pointer, or fully-derived state) used everywhere a naive implementation might otherwise mutate a historical fact.

Each gate builds on the ones before it without reopening them; where a later gate found a genuine inconsistency in an earlier one's drafting (documented in each gate's own Codex report), the fix was to make the later gate conform to the earlier one, never the reverse.

## Canonical Documents

| Document | Covers |
|---|---|
| [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) | The 16 entities + ActorRef: purpose, identifiers, relationships |
| [`PERSISTENCE_AND_IMMUTABILITY.md`](./PERSISTENCE_AND_IMMUTABILITY.md) | Persistence classification, mutation rules, correction mechanisms for every entity |
| [`FORMULA_AND_DERIVATION_CONTRACT.md`](./FORMULA_AND_DERIVATION_CONTRACT.md) | The 8 formulaTypes, compatibility rules, `DerivedMeasurement` semantics |
| [`IDENTITY_AND_ACCOUNTABILITY.md`](./IDENTITY_AND_ACCOUNTABILITY.md) | `ActorRef`, `actorType`, the human-accountability boundary |
| [`REPORTING_AND_REPLAY.md`](./REPORTING_AND_REPLAY.md) | `Report` vs `ReportSnapshot`, issuance pinning, withdrawal |
| [`INVARIANTS.md`](./INVARIANTS.md) | The 17 non-negotiable invariants this architecture exists to guarantee |
| [`CHANGE_CONTROL.md`](./CHANGE_CONTROL.md) | How and when this frozen architecture may ever be changed |

## Binding Statements

**Implementation must conform to these documents.** Any implementation of Camera Measurements — application code, database schema, or API surface — that diverges from the entity set, persistence rules, formula contract, identity model, or reporting rules described here is non-conformant, regardless of whether it "works," until this document set is amended through the process in `CHANGE_CONTROL.md`.

**This frozen architecture may not be changed without a proven blocking contradiction and a new review gate.** A preference, a simplification, an aesthetic inconsistency between two entities' patterns, or an implementation convenience is never sufficient grounds to alter anything in this document set. Only a demonstrated, concrete failure mode — one that would corrupt data, break reproducibility, or violate an invariant in `INVARIANTS.md` — justifies reopening any part of it, and even then only through the gated process `CHANGE_CONTROL.md` defines.
