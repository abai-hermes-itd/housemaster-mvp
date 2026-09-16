# Persistence & Immutability Contract — Camera Measurements MVP

Authoritative source: GATE-0D/HG-4 and its Codex/fix passes, plus GATE-0E/HG-5-FIX (CalibrationSession validity boundary, SpatialTarget split/merge lineage, Geometry concurrency, SurveyAssignment consistency rule). This document is the single place that answers, for every entity: what may never be mutated, what may be mutated, and exactly what mechanism replaces "just editing the row" wherever mutation is forbidden.

No SQL or storage-engine design is specified here — only the architectural contract an implementation must satisfy, by whatever mechanism (DB constraints, triggers, or a strictly-enforced access layer).

## Persistence Classification (17 items)

| Class | Count | Members |
|---|---|---|
| `APPEND_ONLY_FACT` | 6 | CalibrationSession, Measurement, Evidence, Proposal, Decision, KnowledgeCitation |
| `VERSIONED_APPEND_ONLY` | 3 | Geometry, FormulaDefinition, DerivedMeasurement |
| `MUTABLE_OPERATIONAL_STATE` | 4 | SurveyAssignment, ScopeItem, MeasurementSession, Report |
| `IMMUTABLE_SNAPSHOT` | 1 | ReportSnapshot |
| `REFERENCE_IDENTITY` | 3 | Building, SpatialTarget, ActorRef |

**Total: 17** (16 core entities + ActorRef).

`MeasurementSession` is classified `MUTABLE_OPERATIONAL_STATE` rather than append-only: although most of its fields are set once, its `OPEN → CLOSED` lifecycle transition is a genuine, expected piece of current-state, exactly like `SurveyAssignment`/`ScopeItem`/`Report` — grouping it with those, rather than treating it as "append-only with one exception," keeps the taxonomy's own internal logic consistent. `CalibrationSession`, by contrast, has no field that is ever independently mutated (its apparent "status" is fully derived — see below) — it belongs with `Measurement`/`Evidence` as `APPEND_ONLY_FACT`.

## The Governing Principle

Not every field that changes over time needs a forward-pointer/lineage mechanism. Only fields that define **what happened** — a fact — need one. Fields that merely gate **current or future eligibility** (a status flag) can be safely, simply mutable, because mutating them never redefines what any past record means. This single distinction resolves nearly every rule below:

- **Facts** (a measured value, a captured shape, a formula's implementation, a computed result, a decision, a citation, a piece of evidence): once written, never touched again. Correction = a new row, linked by a forward pointer set once, at the new row's own creation. "Current" is a derived read-time query over that pointer graph — never a stored flag, never a `createdAt`-recency heuristic.
- **Eligibility gates** (is this target/formula/calibration/actor currently usable for *new* work): freely mutable, one-way where noted, and — critically — such mutation must never alter what any already-created historical record means or how it replays.

## Per-Entity Rules

### Measurement — `APPEND_ONLY_FACT`
Every field (`value`, `unit`, `entryMethod`, `actorId`, `sourceRef`, `calibrationSessionId`, `measurementType`, timestamps, correction fields) is set once. **There is no mutable field on `Measurement` at all.** Correction: a new `Measurement` row with `correctsMeasurementId` (linear, acyclic — validated at write time), `correctionReason`, `correctionActor`. "Current" = the leaf of the correction chain — the row nothing else's `correctsMeasurementId` points to — resolved by traversal, never by `createdAt`.

### Geometry — `VERSIONED_APPEND_ONLY`
Identity is the **composite `(geometryId, version)`**. Each version is fully immutable. Correction = a new row **under the same `geometryId`**, `version + 1` — never a new `geometryId`, never an in-place edit. The `(geometryId, version)` pair is enforced **unique**; creating a new version is guarded by an **atomic compare-and-create** (optimistic-concurrency) check against the currently-observed version, so two concurrent correction attempts can never both succeed in creating the same next version or produce a duplicate/conflicting version number — the losing attempt must retry against a freshly-read current version. `DerivedMeasurement`/`ReportSnapshot` always pin the exact composite pair. "Current version" (highest version for a `geometryId`) is a derived concept used only for *new*-work queries; historical replay always resolves the pinned composite, never substituting the current version.

### FormulaDefinition — `VERSIONED_APPEND_ONLY`
Identity is the composite `(formulaType, version)`. Immutable from creation, in full — no field is ever mutated, including status. **`ACTIVE`/`DEPRECATED` is fully derived**: `ACTIVE` = no other row's `supersedesFormulaVersion` references this version; `DEPRECATED` = one does. `supersedesFormulaVersion` is written only on the successor, at its own creation. No auto-recompute or auto-migration of any `DerivedMeasurement` pinned to a superseded version — ever. A `FormulaDefinition` row is never deleted, under any circumstance (including before first use — a uniform, exception-free rule).

### DerivedMeasurement — `VERSIONED_APPEND_ONLY`
Every field is set once. `supersedesDerivedMeasurementId` (self-referential, set once at creation, linear + acyclic) replaces the predecessor within the same **`semanticResultKey`** (see `FORMULA_AND_DERIVATION_CONTRACT.md` for the full 4-part key). "Current" = the leaf of the chain within one `semanticResultKey`. No independent trust/status field exists on this entity — its provenance characteristics are always read from its pinned inputs. `grossSourceDerivedMeasurementId` (present only when `formulaType === GROSS_MINUS_OPENINGS`) follows the identical discipline: set once at creation, never mutated, resolved by exact pinned id only — a historical or since-superseded host/opening source remains a valid pin forever, exactly as already true for every other pinned reference on this entity; see `FORMULA_AND_DERIVATION_CONTRACT.md`'s host/openings structural split for the full write-time validation rules.

### CalibrationSession — `APPEND_ONLY_FACT`
Every core field (`deviceRef`, `calibratedAt`, `referenceMethod`, `actorId`, `validUntilAt`) is set once. **`validUntilAt` pins the historical validity boundary at creation time**, computed from whatever validity-window policy was in effect at that moment — it is never recalculated later, so a subsequent change to the validity-window policy can never reinterpret an existing `CalibrationSession`'s outcome. A new calibration may carry `supersedesCalibrationSessionId` (set once, on the **new** row only — the predecessor is never touched). `EXPIRED` is derived by comparing the current time against the row's own frozen `validUntilAt` (the boundary is fixed; only "now" moves); `VALID` is the negation; `SUPERSEDED` is derived from the existence of a successor pointing at it. A historical `Measurement` may continue citing an old, now-stale calibration — its validity *as cited* is exactly the frozen outcome pinned at that calibration's creation, unaffected by any later policy change or by the calibration's current derived eligibility. Retry/recalibration always creates a new row.

### Evidence — `APPEND_ONLY_FACT`
Immutable from creation, no exception. **No correction/supersession chain exists in MVP.** Wrong or replacement evidence is simply a new, independent `Evidence` row; higher-level records (Measurement, MeasurementSession) reference whichever row is the intended one directly. The referenced payload itself (whatever the `storageRef` points to) must be immutable/verifiable at the storage layer — an integrity value (e.g., a content hash) is required alongside `storageRef` so that a payload cannot be silently swapped behind the same `evidenceId` without detection. (No storage-provider implementation is specified here.)

### Proposal — `APPEND_ONLY_FACT`
Immutable from creation, no exception, before or after any `Decision`. A revised suggestion is always a new `Proposal`.

### Decision — `APPEND_ONLY_FACT`
Immutable from creation, no exception. The audit record of what a human decided must never be rewritable.

### KnowledgeCitation — `APPEND_ONLY_FACT`
Immutable from creation. `sourceRef`, `snippet`, `retrievedAt` freeze exactly what was cited, permanently, regardless of later changes to the live source.

### ReportSnapshot — `IMMUTABLE_SNAPSHOT`
**Zero writable fields after creation. No exception — not even a narrow, well-scoped one.** Never regenerated under the same `snapshotId`; re-issuance always produces a distinct new snapshot. See `REPORTING_AND_REPLAY.md` for the full pinning list and for why withdrawal is represented on `Report`, never on `ReportSnapshot` itself.

### SpatialTarget — `REFERENCE_IDENTITY`
`targetId`, `targetType`, `buildingId`: immutable from creation. `parentTargetId` never mutates in place — a wrong-parent case requires retire + create-new + lineage. `status` (`ACTIVE → RETIRED`) is the one legitimately mutable field: one-way, terminal (no reactivation), writing only `status`/`retiredAt`/`retiredReason`/`retiredActor` at the single retirement event. **`replacesTargetIds` is written only on the new target, at its own creation** (authoritative direction) and may hold multiple entries — **split** (one predecessor, many successors) and **merge** (many predecessors, one successor) are both allowed; the resulting lineage graph is validated **acyclic** (a graph, not a linear chain) and every entry must share the **same `buildingId`** as the new target, with no self-reference — both are **rejected at write time** otherwise. **`supersededByTargetIds` is never a written field** — it is a derived query view only. Historical `Measurement`/`Geometry`/`DerivedMeasurement` links to a retired target remain valid forever; only new work is blocked.

### ActorRef — `REFERENCE_IDENTITY`
`actorId`, `actorType`: immutable. `displayName`: live/mutable everywhere except `ReportSnapshot`, which pins its own copy at issuance. `status` (`ACTIVE ↔ INACTIVE`): mutable, bidirectional, and never conditions the validity of any historical record. `externalSubjectRef`: optional, becomes immutable the instant it is first populated (no relinking in MVP), and must be unique across all `ActorRef` rows when set. Full detail: `IDENTITY_AND_ACCOUNTABILITY.md`.

### Building — `REFERENCE_IDENTITY`
`buildingId`: immutable, non-recycled — the only field carrying reproducibility weight. All descriptive metadata (name, address) may be corrected freely; none of it participates in any calculation. `ReportSnapshot` pins a copy of the building's identifying details at issuance (see `REPORTING_AND_REPLAY.md`) so that a later correction to `Building.name`/`address` never alters an already-issued report's presented content.

### SurveyAssignment — `MUTABLE_OPERATIONAL_STATE`
`assignedOperator` is a freely-settable current-assignee pointer. **Every reassignment appends an immutable entry to `reassignmentHistory[]`**: `{fromOperator, toOperator, changedBy, changedAt}` — appended atomically with the state change, never edited or removed. **Consistency rule**: `assignedOperator` must always equal the `toOperator` of the most recent entry in `reassignmentHistory[]` (or the original assignee if no reassignment has occurred yet) — the current pointer and the append-only history may never drift apart. `assignedOperator` is never the source of truth for "who did a specific historical action" — that is always read from the individual action record's own `actorId`.

### ScopeItem — `MUTABLE_OPERATIONAL_STATE`
`status` ∈ `{PENDING, DONE, SKIPPED}` (mutually exclusive), `fulfillingSessionId`. Completion requires `completedBy`/`completedAt`; skip requires `skippedBy`/`skippedAt`/`skipReason` — set once, atomically with the transition. **Reopen of a completed/skipped item is DEFERRED for MVP** — no safe representation exists without either overwriting prior attribution or adding a new entity, and no demonstrated MVP need forces the question now.

### MeasurementSession — `MUTABLE_OPERATIONAL_STATE`
`status` ∈ `{OPEN, CLOSED}`, one-way, terminal. Closure requires `closedBy`/`closedAt`, atomic with the transition. No new `Measurement` may be added after closure; continuation is always a **new** `MeasurementSession`.

### Report — `MUTABLE_OPERATIONAL_STATE`
Remains a live container across its entire life; may be issued multiple times, each issuance producing a new `ReportSnapshot`. Holds an append-only `withdrawalRecords[]` (see `REPORTING_AND_REPLAY.md`).

## Cross-Cutting Rules

1. **No UPDATE for any `APPEND_ONLY_FACT`, `VERSIONED_APPEND_ONLY`, or `IMMUTABLE_SNAPSHOT` entity's own content fields.** — `REQUIRED`
2. **Corrections create new records/versions**, never edit the original. — `REQUIRED`
3. **Immutable IDs (`buildingId`, `targetId`, `geometryId`, `formulaType`, `evidenceId`, `actorId`, `snapshotId`, etc.) are never recycled or reused**, even after the entity they identify is retired/deprecated/withdrawn. — `REQUIRED`
4. **Historical references remain resolvable forever**, regardless of the referenced row's *current* derived status (retired, deprecated, expired, superseded, withdrawn, inactive all included). — `REQUIRED`
5. **Supersession uses a forward pointer written once on the new record**, pointing at its predecessor — never a field written on the predecessor. The one deliberate exception in kind, not in discipline, is `FormulaDefinition`'s `(formulaType, version)` composite-key model, appropriate because it is a curated, engineering-versioned artifact rather than field-corrected data — even there, the predecessor is never updated. — `REQUIRED`
6. **Historical replay uses pinned IDs/versions only** — never "latest," never a live join to current state. — `REQUIRED`
7. **Current-state queries must never alter historical truth.** Computing "what is current" is always a read, never a write to any historical row. — `REQUIRED`
8. **Live operational status must never retroactively invalidate a historical fact.** A target's retirement, a formula's deprecation, a calibration's expiry, an actor's deactivation, a report's withdrawal — none of these change what any past record, once created, means or contains. — `REQUIRED`

## Failure-Mode Register

| # | Failure mode | Why bad | Guard |
|---|---|---|---|
| 1 | Accidental UPDATE of Measurement | Silently changes a raw fact; every downstream calculation/report becomes wrong with no trace | Zero mutable fields on Measurement; INSERT-only |
| 2 | Geometry overwrite | Silently changes area/length for anything already computed from it | Immutable `(geometryId, version)`; correction = new row, same `geometryId`, `version + 1` |
| 3 | DerivedMeasurement recomputation in place | The core failure invariant #12 exists to prevent | `supersedesDerivedMeasurementId` forward-pointer only, never UPDATE |
| 4 | FormulaDefinition version edit | Breaks "formula meaning frozen forever"; silently changes what every pinned DerivedMeasurement means | Immutable from creation, even pre-use; new logic = new version, always |
| 5 | ReportSnapshot regeneration under same ID | The most direct possible violation of invariant #12 | Content immutable from creation; re-issuance always a new, distinct snapshot |
| 6 | Current actor rename changing an issued report | Attribution silently drifts | `actorDisplayNameAtIssuance` pinned once, never re-resolved live |
| 7 | SpatialTarget type change | Retroactively reclassifies every Measurement/Geometry/DerivedMeasurement already attached | `targetType` immutable from creation; reclassification requires retire + new target + lineage |
| 8 | Reassignment overwriting audit history | Could appear to erase who actually did earlier work | `assignedOperator` reflects current responsibility only; every action record carries its own independent `actorId`; reassignment itself is logged in `reassignmentHistory[]` |
| 9 | Proposal edit after Decision | Retroactively changes what a human actually approved | Proposal immutable from creation, no edit path at any point |
| 10 | Decision edit after authoritative result | Rewrites the audit trail of who approved what | Decision immutable from creation, no exceptions |
| 11 | Evidence replacement under same ID | Silently swaps the evidentiary basis for a measurement | Evidence immutable from creation; replacement is a new row |
| 12 | Current-status filtering breaking historical replay | A retired/deprecated/expired/withdrawn referenced item wrongly appears missing when resolving an old pinned reference | Historical resolution of pinned IDs is unconditional; status filters apply only to "what's eligible for new work" |
| 13 | Stored lifecycle status drifting from its own supersession graph | Two independently-writable representations of the same fact (a stored flag and the actual pointer graph) can silently disagree | `FormulaDefinition` and `CalibrationSession` carry no stored status field; ACTIVE/DEPRECATED and VALID/EXPIRED/SUPERSEDED are always derived from the pointer graph (or a timestamp rule) |
| 14 | Under-specified `semanticResultKey` causing wrong-current collision | A legitimate result (e.g., net area) could silently suppress another legitimate result (e.g., gross area) from "current" resolution | `semanticResultKey` is always the full 4-part `(targetId, outputQuantityType, semanticCategory, calculationScope)` |
| 15 | Any post-creation mutation of ReportSnapshot, however narrowly scoped | Erodes the one entity whose sole purpose is absolute immutability, and sets a precedent for further erosion | ReportSnapshot has zero writable fields after creation, without exception; withdrawal lives on `Report` instead |
