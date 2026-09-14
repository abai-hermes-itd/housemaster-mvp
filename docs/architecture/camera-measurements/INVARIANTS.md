# Invariants — Camera Measurements MVP

This is the canonical, numbered register of the non-negotiable properties this architecture exists to guarantee. Every entity, field, and rule in the other six documents in this set traces back to one or more of these. Nothing here is invented for this document — each invariant was established at the review gate cited and carried forward, unmodified in substance, through every subsequent gate.

1. **Physical identity ≠ workflow identity.** A `Building`/`SpatialTarget` (the physical object) is never conflated with the `SurveyAssignment`, `ScopeItem`, or `MeasurementSession` (the workflow records) that happen to reference it. *(R3A/HG-1)*

2. **Raw ≠ Derived ≠ Reported.** `Measurement` (raw), `DerivedMeasurement` (computed), and whatever a `ReportSnapshot` presents (reported) are three distinct concepts that never collapse into one. *(R3A/HG-2)*

3. **Stable IDs are never recycled.** `buildingId`, `targetId`, `geometryId`, `formulaType`, `evidenceId`, `actorId`, `snapshotId`, `calibrationSessionId` — none is ever reused once assigned, even after the row it identifies is retired, deprecated, expired, or withdrawn. *(R3A/HG-1/HG-3/HG-4)*

4. **Historical, immutable facts never receive an UPDATE.** `Measurement`, `Geometry`, `FormulaDefinition` (per version), `DerivedMeasurement`, `Evidence`, `Proposal`, `Decision`, `KnowledgeCitation`, and `ReportSnapshot` are write-once. *(HG-4)*

5. **Corrections create new records/versions**, never edit the original — `correctsMeasurementId`, a new `(geometryId, version)` row, `supersedesFormulaVersion`, `supersedesDerivedMeasurementId`, `supersedesCalibrationSessionId` are all forward pointers set once, on the new row, never a field written back onto the predecessor. *(HG-2/HG-4)*

6. **Derived lineage is acyclic.** The `DerivedMeasurement.supersedesDerivedMeasurementId` chain is linear and validated acyclic at write time. *(HG-2)*

7. **`SpatialTarget` containment is acyclic.** `parentTargetId` cannot form a loop, and depth is bounded to 3 levels. *(HG-1)*

8. **Formula applicability is checked before execution.** A `formulaType` may only be applied to a compatible `targetType` and `requiredGeometryType`, per the static tables in `FORMULA_AND_DERIVATION_CONTRACT.md` — never left to operator/UI discretion alone. *(HG-2)*

9. **No silent defaults.** A `SYSTEM_ASSUMED` value always carries a mandatory `assumptionReason`, is never permitted to be the *only* input to a formula call (at least one real observation is required), and is always visibly flagged, never presented as equivalent to a measured value. *(R3A/HG-2)*

10. **Assumed-input provenance propagates transitively.** Any `DerivedMeasurement` whose input set includes any assumption-derived value must itself carry the flag, recursively, all the way to `ReportSnapshot` rendering. *(R3B/HG-2)*

11. **Knowledge never becomes Measurement evidence.** `KnowledgeCitation` is structurally disjoint from `Evidence` — no shared numeric-value field, and Knowledge content never populates a `Measurement`/`Geometry`/`DerivedMeasurement`/`Evidence` field directly. *(R3A/R3B)*

12. **An issued `ReportSnapshot` never changes.** Zero writable fields after creation, no exception; withdrawal is represented on `Report`, never as a mutation of the snapshot itself. *(R3A/HG-4)*

13. **Historical replay uses pinned references only.** A `ReportSnapshot`, once issued, resolves every fact it presents from the exact IDs/versions it pinned at issuance — never a live re-resolution of "current." *(R3B/HG-2/HG-4)*

14. **Live/current status never retroactively invalidates history.** A target's retirement, a formula's deprecation, a calibration's expiry, an actor's deactivation, a report's withdrawal — none of these change what any already-created historical record means, contains, or resolves to. *(HG-4)*

15. **Human accountability for every nondeterministic authoritative write.** Every action in the Action → Actor table in `IDENTITY_AND_ACCOUNTABILITY.md` requires a `HUMAN_OPERATOR`, except the one deterministic case (`DerivedMeasurement` creation, `NOT_APPLICABLE`) and the one dual-authorship case (`Proposal`, `HUMAN_OPERATOR` or `AGENT`) — `AGENT` never authors a `Decision` or any resulting authoritative record. *(HG-3)*

16. **Successor chains that define current state are linear and acyclic.** `Measurement.correctsMeasurementId`, `DerivedMeasurement.supersedesDerivedMeasurementId`, `FormulaDefinition.supersedesFormulaVersion`, `CalibrationSession.supersedesCalibrationSessionId`, and `SpatialTarget.replacesTargetIds` are each validated linear (at most one successor) and acyclic at write time. *(HG-2/HG-4)*

17. **Evidence payload is immutable/verifiable.** The object a `storageRef` points to is never silently replaced behind the same `evidenceId`; an integrity value accompanies the reference so a swap is detectable, not merely discouraged by convention. *(HG-4)*

## Using This Register

Any proposed change to the architecture must state, explicitly, which of these 17 invariants (if any) is at risk if the change is *not* made, and confirm that none is weakened by the change itself. See `CHANGE_CONTROL.md` for the process this requires.
