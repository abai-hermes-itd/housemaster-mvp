# Domain Model — Camera Measurements MVP

Authoritative source: Math/Topology v0.2 MVP freeze, GATE-0A/HG-1, GATE-0B/HG-2, GATE-0D/HG-4 (and their Codex/fix passes), and GATE-0E/HG-5-FIX (calibration validity boundary, SpatialTarget split/merge lineage, same-building replacement, Geometry concurrency, accepted-Proposal provenance).

This document describes the **frozen entity set only** — no new entity may be introduced here, and none of the 16 core entities plus `ActorRef` may be removed. It describes purpose, identifiers, and relationships; it deliberately contains no SQL, schema, or storage-implementation detail — that is out of scope for architecture documentation and out of scope for this gate.

## Entity Set (16 core + 1 supporting)

```
Building → SpatialTarget → SurveyAssignment → ScopeItem → MeasurementSession
→ CalibrationSession → Measurement → Geometry → FormulaDefinition
→ DerivedMeasurement → Evidence → Report → ReportSnapshot
→ Proposal → Decision → KnowledgeCitation

ActorRef (supporting identity/reference model, used by nearly every entity above)
```

## Building

**Purpose**: root identity anchor for everything physical surveyed in the system.
**Primary identifier**: `buildingId` — stable, non-recycled.
**Relationships**: parent of every `SpatialTarget` (via `buildingId`), parent of every `SurveyAssignment`.
**Mutable**: descriptive metadata (name, address) may be corrected freely — see `PERSISTENCE_AND_IMMUTABILITY.md`. None of it participates in any calculation, so its mutability has zero reproducibility impact on its own — but see `REPORTING_AND_REPLAY.md` for why `ReportSnapshot` pins a copy of it at issuance anyway.

## SpatialTarget

**Purpose**: the stable, physical-object identity for anything measured — a room, facade, roof, attic, stair area, opening, apartment unit, or defect. This is the entity that makes physical identity survive repeat surveys, distinct from any workflow record that happens to reference it. It is the **addressable measurement subject/context** for the MVP — not a canonical, future asset-ontology entity; no housing-stock ontology is modeled here (see `targetType` below).
**Primary identifier**: `targetId` — stable, non-recycled, **immutable from creation, forever**.
**`targetType`** (immutable from creation): `ROOM`, `BASEMENT_TECH`, `FACADE`, `ROOF`, `ATTIC`, `STAIR_AREA`, `OPENING`, `APARTMENT_UNIT`, `DEFECT_AREA`, `DEFECT_LINEAR` — a flat, closed enum; no housing-stock ontology (`SpatialUnit`/`Surface`/`System`/`Component`/`Asset`/`LinearElement`) is modeled.
**`aggregationRole`** (derived from `targetType`, never stored, never overridable): `ADDITIVE_SPATIAL`, `SUBTRACTIVE_FEATURE`, `NON_AGGREGATING`.
**Containment**: `parentTargetId` — optional or required depending on `targetType` (see the HG-1 per-type table); the resulting containment graph is **acyclic**, depth-bounded to 3 levels, and never mutates in place — a wrong-parent case requires retire + create-new + lineage.
**Lineage (authoritative direction)**: `replacesTargetIds[]` is written **only on the new `SpatialTarget`**, once, at its own creation, and may hold more than one entry — **split** (one target replaced by several new targets) and **merge** (several targets replaced by one new target) are both supported. The resulting lineage graph is **acyclic**, but — unlike Measurement/DerivedMeasurement/FormulaDefinition/CalibrationSession lineage — it is **not restricted to one successor**; it is a graph, not a linear chain. Every entry must reference a **different** target within the **same `buildingId`** as the new target — a self-referencing entry or a cross-building entry is **rejected at write time**. `supersededByTargetIds` is **never a written field** — it exists only as a derived query view over other targets' `replacesTargetIds`. Once written, `replacesTargetIds[]` is never edited.
**Lifecycle**: `status` ∈ `{ACTIVE, RETIRED}` — a one-way, **terminal** transition (no reactivation in MVP). Retirement writes only `status`, `retiredAt`, `retiredReason`, `retiredActor` — nothing else.
**Historical references**: a retired target's existing `Measurement`/`Geometry`/`DerivedMeasurement` links remain valid forever; only *new* work is blocked from targeting a retired `SpatialTarget`.

## SurveyAssignment

**Purpose**: scopes a field engagement — which building, assigned to which operator, in what status.
**Primary identifier**: `assignmentId`.
**Relationships**: `buildingId` (parent), `1 → many ScopeItem`.
**Mutable**: `status`, `assignedOperator` (current-assignee pointer) — every reassignment appends an immutable transition record; see `PERSISTENCE_AND_IMMUTABILITY.md`.

## ScopeItem

**Purpose**: one required-measurement task within an assignment, against one `SpatialTarget`.
**Primary identifier**: `scopeItemId`.
**Relationships**: `assignmentId` (parent), `targetId` (subject), `1 → many MeasurementSession` (re-measurement allowed), `fulfillingSessionId` (which session is authoritative for completion).
**Fields**: `requiredMeasurementTypes[]` (shared vocabulary with `Measurement.measurementType`).
**Mutable**: `status` ∈ `{PENDING, DONE, SKIPPED}`, `fulfillingSessionId` — completion/skip carries set-once attribution; reopen is deferred for MVP.

## MeasurementSession

**Purpose**: the atomic unit of one operator measuring exactly one `SpatialTarget` at one point in time — never a multi-target field visit (a `FieldVisit`/`SurveyRun` grouping concept remains deferred, safely additive later).
**Primary identifier**: `sessionId`.
**Relationships**: `targetId` (exactly one), `scopeItemId`, `1 → many Measurement`, `0..1 CalibrationSession` (required iff any resulting `Measurement.entryMethod = CAMERA_OBSERVED`).
**Lifecycle**: `status` ∈ `{OPEN, CLOSED}` — one-way, terminal; closure requires `closedBy`/`closedAt`; more measurements after closure require a **new** session.

## CalibrationSession

**Purpose**: the data anchor that must exist before any `CAMERA_OBSERVED` measurement can be considered trustworthy.
**Primary identifier**: `calibrationSessionId`.
**Minimum fields**: `deviceRef`, `calibratedAt`, `referenceMethod`, `actorId`, `validUntilAt`.
**Historical validity is frozen at creation**: `validUntilAt` is computed once, at creation, from whatever validity-window policy was in effect at that moment, and is never recalculated. A later change to validity-window policy applies only to calibrations created after that change — it can never reinterpret an already-created `CalibrationSession`'s pinned boundary or outcome.
**Supersession**: a new `CalibrationSession` may carry `supersedesCalibrationSessionId` (set once, on the new row only) — the predecessor is never touched. `EXPIRED` is derived by comparing the current time against the row's own frozen `validUntilAt` (the boundary never moves, only "now" does); `VALID` is the negation; `SUPERSEDED` is derived from the existence of a successor pointing at it. None of the three is stored.

## Measurement

**Purpose**: a raw captured or entered value — the single most protected entity in the model.
**Primary identifier**: `measurementId`.
**Relationships**: `sessionId` (parent), `targetId` (implicit via session), `0..1 Geometry` (some measurements are scalar-only), `0..1 correctsMeasurementId` (self-referential correction chain), `0..1 calibrationSessionId` (required iff camera-observed), `actorId`, `0..1 acceptingDecisionId` (set once, only if this Measurement resulted from an accepted `Proposal` — see `IDENTITY_AND_ACCOUNTABILITY.md`).
**`entryMethod`**: `MANUAL_ENTERED`, `CAMERA_OBSERVED`, `SYSTEM_ASSUMED`, `IMPORTED_HISTORIC` (correction is a relationship, not a 5th entry method).
**Companion fields by entry method**: `sourceRef` (required if `IMPORTED_HISTORIC`), `assumptionReason` (required if `SYSTEM_ASSUMED`).
**Immutability**: every field is set once at creation; there is **no mutable field on `Measurement` at all**. A correction is always a brand-new row.

## Geometry

**Purpose**: the captured shape (Point/Polyline/Polygon) behind a non-scalar measurement.
**Primary identifier**: **composite `(geometryId, version)`** — `geometryId` stable, `version` an immutable, monotonically incrementing integer per `geometryId`.
**Primitives**: `POINT`, `POLYLINE`, `POLYGON` only — no `Plane`, `Boundary`, `Surface`, or `DefectGeometry` as separate primitive types.
**Rule**: one `Polygon` = one plane, always; a multi-plane facade/roof is modeled as multiple `SpatialTarget`s combined via `AGGREGATE_SUM`, never as one non-planar polygon.
**Immutability**: each `(geometryId, version)` row is fully immutable; a correction creates a **new row under the same `geometryId`** with `version + 1`. `DerivedMeasurement` and `ReportSnapshot` always pin the exact composite identity.
**Concurrency**: `(geometryId, version)` is enforced **unique** — no two rows may ever share the same pair. Creating the next version is an **atomic compare-and-create** operation, guarded against the currently-observed version (an optimistic-concurrency check): two concurrent attempts to create "the next version" for the same `geometryId` can never both succeed — exactly one wins, and the loser must retry against a freshly-read current version. Historical replay always resolves the exact pinned composite identity, never a re-computed "latest."

## FormulaDefinition

**Purpose**: the versioned, curated definition of one of the 8 frozen calculation types.
**Primary identifier**: composite `(formulaType, version)`.
**Immutability**: immutable from creation, in full — even before first use; no exception for hard-delete-before-first-use (removed for uniform simplicity).
**Lifecycle**: `ACTIVE`/`DEPRECATED` are fully **derived** (no successor references this version = ACTIVE; a successor's `supersedesFormulaVersion` references it = DEPRECATED) — never a stored field.
**`formulaType` meaning is permanently frozen** at first use — a genuine redefinition requires a new `formulaType`, never a new version of an old one.
Full catalogue and rules: `FORMULA_AND_DERIVATION_CONTRACT.md`.

## DerivedMeasurement

**Purpose**: a computed value produced by exactly one `FormulaDefinition` version applied to a pinned input set.
**Primary identifier**: `derivedMeasurementId`.
**Relationships**: pins exact `(formulaType, version)`, pins exact input IDs (Measurement / Geometry `(geometryId, version)` / other DerivedMeasurement IDs), `0..1 supersedesDerivedMeasurementId` (self-referential, set once at creation, linear + acyclic). `0..1 grossSourceDerivedMeasurementId` — required only when `formulaType === GROSS_MINUS_OPENINGS` (forbidden otherwise) — pins that result's single gross-area host source as a structurally distinct slot from its `inputDerivedMeasurementIds` (which, for that one `formulaType`, holds the opening sources only); see `FORMULA_AND_DERIVATION_CONTRACT.md`'s `GROSS_MINUS_OPENINGS` — host/openings structural split for the full write-time validation rules.
**`semanticResultKey`** — the domain within which "current" resolution and supersession apply — is **4-part**: `(targetId, outputQuantityType, semanticCategory, calculationScope)`. A 2-part shorthand is insufficient and causes gross/net and multi-aggregate-scope collisions — see `FORMULA_AND_DERIVATION_CONTRACT.md`.
**No stored actor** — `DerivedMeasurement` creation is a deterministic computation (`NOT_APPLICABLE` actor, per `IDENTITY_AND_ACCOUNTABILITY.md`), and it carries no independent trust/status field of its own.

## Evidence

**Purpose**: a physical-capture artifact (photo, video, note, calibration artifact) supporting a `MeasurementSession`.
**Primary identifier**: `evidenceId`.
**Immutability**: immutable from creation, no exception; no correction/supersession chain — a replacement is simply a new, independently-referenced `Evidence` row.
**Storage**: `storageRef` is a pointer into object storage, never an inline blob; `sourceType` is restricted to physical-capture provenance and can never be a Knowledge/RAG object.
**Provenance**: `0..1 acceptingDecisionId` (set once, only if this Evidence resulted from an accepted `Proposal`).

## Report

**Purpose**: the mutable, ongoing container for a survey's reporting life — may be issued multiple times over its life.
**Primary identifier**: `reportId`.
**Mutable**: `status`, covered `ScopeItem` set; append-only `withdrawalRecords[]` (see `REPORTING_AND_REPLAY.md`).

## ReportSnapshot

**Purpose**: the immutable, point-in-time artifact produced at each issuance — the entity invariant #12 exists to protect.
**Primary identifier**: `snapshotId` (never regenerated under the same ID).
**Immutability**: **zero writable fields after creation.** No exceptions — not even a narrowly-scoped withdrawal flag; see `REPORTING_AND_REPLAY.md` for why withdrawal lives on `Report` instead.
**Pins at issuance**: full detail in `REPORTING_AND_REPLAY.md`.

## Proposal

**Purpose**: a suggested change — human-to-human or AI/Guide-to-human — that is never itself authoritative.
**Primary identifier**: `proposalId`.
**Author**: `HUMAN_OPERATOR` or `AGENT` (see `IDENTITY_AND_ACCOUNTABILITY.md`).
**Immutability**: immutable from creation, no exception, before or after any `Decision`. A revised suggestion is a new `Proposal`, not an edit.

## Decision

**Purpose**: the audit record of a human accepting or rejecting a `Proposal` — the enforcement point of human accountability for AI-originated suggestions.
**Primary identifier**: `decisionId`.
**Relationships**: `proposalId` (the proposal decided on), `actorId` (**must be `HUMAN_OPERATOR`, never `AGENT`**).
**Immutability**: immutable from creation, no exception.

## KnowledgeCitation

**Purpose**: a pointer to knowledge/regulatory/RAG context attached to a `Proposal` (or, per HG-3-CODEX's broadening, to a `Report` or `SpatialTarget` for direct human-authored citation) — structurally disjoint from `Evidence`, never a measurement value.
**Primary identifier**: `citationId`.
**Fields**: `sourceRef`, `snippet` (the retrieved text, frozen verbatim), `retrievedAt`.
**Immutability**: immutable from creation — freezes exactly what was cited regardless of later changes to the live knowledge source. No correction mechanism; a bad citation is simply not reused.
**Boundary rule**: `KnowledgeCitation` must never gain a numeric field intended to represent a measurement quantity, and Knowledge content must never populate a `Measurement`/`Geometry`/`DerivedMeasurement`/`Evidence` field directly.

## ActorRef (supporting identity/reference model)

**Purpose**: the stable identity every provenance field in the 16 core entities points to.
**Primary identifier**: `actorId` — immutable, non-recycled.
**`actorType`** (immutable from creation): `HUMAN_OPERATOR`, `AGENT`.
Full rules: `IDENTITY_AND_ACCOUNTABILITY.md`.

## Authoritative vs. Derived Relationships — Summary

| Relationship | Authoritative side (written) | Derived side (never written) |
|---|---|---|
| SpatialTarget lineage | `replacesTargetIds` on the new target | `supersededByTargetIds` (query-derived) |
| Geometry versions | new row under same `geometryId`, `version + 1` | "current version" (query-derived, for new-work queries only) |
| FormulaDefinition lineage | `supersedesFormulaVersion` on the successor | `status` ACTIVE/DEPRECATED (fully derived) |
| DerivedMeasurement lineage | `supersedesDerivedMeasurementId` on the new row | "current" (leaf of chain within one `semanticResultKey`, query-derived) |
| CalibrationSession lineage | `supersedesCalibrationSessionId` on the new row | `VALID`/`EXPIRED`/`SUPERSEDED` (fully derived) |
| Measurement correction | `correctsMeasurementId` on the new row | "current" (leaf of chain, query-derived) |
| Report withdrawal | `Report.withdrawalRecords[]` (append-only) | ReportSnapshot's own current usability (query-derived from Report) |

This single pattern — write forward, derive backward, never mutate the predecessor — is the load-bearing mechanism behind nearly every guarantee in `INVARIANTS.md`. See `PERSISTENCE_AND_IMMUTABILITY.md` for the full rule set.
