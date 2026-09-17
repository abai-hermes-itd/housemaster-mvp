# Formula & Derivation Contract — Camera Measurements MVP

Authoritative source: GATE-0B/HG-2 and its Codex/fix pass, refined by GATE-0D/HG-4's `semanticResultKey` correction.

## The 8 Frozen `formulaType` Values

```
RECTANGLE_AREA · POLYGON_AREA · VOLUME · POLYLINE_LENGTH
GROSS_MINUS_OPENINGS · AGGREGATE_SUM · DEFECT_AREA_TOTAL · DEFECT_LENGTH_TOTAL
```

This is a **closed, curated set** — not a general expression language or a rules-engine-configurable catalogue. Adding a formula requires a new review gate, not a configuration change.

| formulaType | Purpose | Input entity kind | Required geometry |
|---|---|---|---|
| `RECTANGLE_AREA` | Quick two-scalar area (matches legacy L×W UX) | 2 scalar Measurements (length, width) | NONE |
| `POLYGON_AREA` | Area of any simple polygon (irregular/L-shaped rooms, facades, roofs, openings, area defects) | 1 Geometry, `POLYGON` | POLYGON |
| `VOLUME` | Interior volume = area × height | 1 area DerivedMeasurement + 1 height Measurement | NONE |
| `POLYLINE_LENGTH` | Length of a linear defect | 1 Geometry, `POLYLINE` | POLYLINE |
| `GROSS_MINUS_OPENINGS` | Net facade/roof area after subtracting compatible openings | 1 gross-area DerivedMeasurement + a set of opening-area DerivedMeasurements | NONE |
| `AGGREGATE_SUM` | Explicit, scoped sum of compatible same-category results | a set of DerivedMeasurements | NONE |
| `DEFECT_AREA_TOTAL` | Explicit, opt-in total damaged area | a set of DEFECT_AREA-sourced area DerivedMeasurements | NONE |
| `DEFECT_LENGTH_TOTAL` | Explicit, opt-in total crack/linear-defect length | a set of DEFECT_LINEAR-sourced length DerivedMeasurements | NONE |

Only the two base formulas (`POLYGON_AREA`, `POLYLINE_LENGTH`) ever consume raw `Geometry` directly. Everything above that layer composes Measurements/DerivedMeasurements.

## Applicability — `formulaType → allowedTargetTypes`

| formulaType | ROOM | BASEMENT_TECH | FACADE | ROOF | ATTIC | STAIR_AREA | OPENING | APARTMENT_UNIT | DEFECT_AREA | DEFECT_LINEAR |
|---|---|---|---|---|---|---|---|---|---|---|
| RECTANGLE_AREA | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| POLYGON_AREA | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
| VOLUME | ✓ | ✓ | — | — | ✓ | — | — | — | — | — |
| POLYLINE_LENGTH | — | — | — | — | — | — | — | — | — | ✓ |
| GROSS_MINUS_OPENINGS (host) | — | — | ✓ | ✓ | — | — | — | — | — | — |
| AGGREGATE_SUM (source) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| DEFECT_AREA_TOTAL (source) | — | — | — | — | — | — | — | — | ✓ | — |
| DEFECT_LENGTH_TOTAL (source) | — | — | — | — | — | — | — | — | — | ✓ |

`VOLUME` is deliberately excluded from `FACADE`/`ROOF`/`STAIR_AREA` — none has a single well-defined "height." `GROSS_MINUS_OPENINGS` is restricted to `FACADE`/`ROOF` hosts only — a `ROOM`-parented `OPENING` may still exist for identity/evidence purposes but is never a valid input to this formula. This applicability table, plus `formulaType → requiredGeometryType`, is checked at `DerivedMeasurement` write time — no `RECTANGLE_AREA`/`VOLUME`/etc. may be computed against an incompatible target type or missing geometry kind.

## Quantity Types

`LENGTH` (m), `AREA` (m²), `VOLUME` (m³) — three canonical physical quantities. `COUNT` and `ANGLE` were reviewed and are **not** part of the frozen MVP set (no formula produces or consumes either).

## `FormulaDefinition` — Minimum Fields & Lifecycle

```
formulaDefinitionId · formulaType · version · implementationRef · implementationHash
inputContract · outputQuantityType · semanticCategory · allowedTargetTypes[]
requiredGeometryType · supersedesFormulaVersion
```

- **Identity**: composite `(formulaType, version)`.
- **Immutable from creation**, in full — no field is ever mutated after the row exists, including any status. There is no hard-delete exception even before first use — a uniform, exception-free rule.
- **`ACTIVE`/`DEPRECATED` is fully derived**, never a stored field: `ACTIVE` = no other `FormulaDefinition` row's `supersedesFormulaVersion` references this `(formulaType, version)`; `DEPRECATED` = one does.
- `supersedesFormulaVersion` is written **only on the successor**, at its own creation. The predecessor is never updated.
- **Successor chain is linear and acyclic** — a version may be superseded by at most one successor, validated at write time.
- **No auto-recompute, no auto-migration** of any `DerivedMeasurement` pinned to a superseded version — superseding a version is a pure lineage/discoverability fact, never a trigger for retroactive change.
- **`formulaType` name meaning is permanently frozen** at first use. A version may fix a bug or improve precision *within* the same semantic definition; it may never change what the formula fundamentally represents. A genuine redefinition requires a new `formulaType`.
- `implementationHash` (alongside `implementationRef`) detects silent code drift under a stable version tag — any change to a formula's actual behavior must mint a new version, checked at deploy/CI time.
- `semanticCategory` (see below) groups formulas by what they semantically represent, independent of their exact `formulaType`.

## Semantic Categories (for `AGGREGATE_SUM` compatibility)

```
RAW_AREA          = { RECTANGLE_AREA, POLYGON_AREA }
NET_AREA          = { GROSS_MINUS_OPENINGS }
DEFECT_AREA_METRIC   = { DEFECT_AREA_TOTAL }
DEFECT_LENGTH_METRIC = { DEFECT_LENGTH_TOTAL }
VOLUME_METRIC     = { VOLUME }
```

`AGGREGATE_SUM`'s input contract requires **all** of:
1. Same `outputQuantityType`.
2. Same `semanticCategory` (not the same exact `formulaType` — two `FACADE`s, one measured via `RECTANGLE_AREA` and one via `POLYGON_AREA`, both `RAW_AREA`, are legitimately summable).
3. Exactly **one** explicit source `targetType` (never an OR-list) — this is what structurally forbids summing `FACADE` area with `ROOF` area, or a `STAIR_AREA` landing projection with `ROOM` floor area.
4. One declared aggregation scope (e.g., a shared `parentTargetId`, or `buildingId` + the single explicit `targetType`).
5. No duplicate source `targetId` in the input set (see Dedup Rule below).
6. A mandatory, atomically-recorded overlap acknowledgement whenever 2+ spatially-relevant inputs are combined (see below).

`DEFECT_AREA_TOTAL`/`DEFECT_LENGTH_TOTAL` follow the same five rules with their own fixed, single-category source set — kept as distinct `formulaType`s rather than folded into a parameterized `AGGREGATE_SUM`, so that every compatibility row stays statically closed and auditable rather than depending on a runtime category parameter.

## `DerivedMeasurement` — Rules

```
derivedMeasurementId · formulaType+version (pinned) · pinned input IDs
grossSourceDerivedMeasurementId (GROSS_MINUS_OPENINGS only)
supersedesDerivedMeasurementId · semanticResultKey
overlapReviewedBy/At/overlapRiskNoted (where applicable)
```

- Append-only / versioned only — every field set once (see `PERSISTENCE_AND_IMMUTABILITY.md`).
- Pins the **exact** `(formulaType, version)` used — never "latest."
- Pins the **exact** input IDs used — `Measurement` IDs, `Geometry` `(geometryId, version)` composites, or other `DerivedMeasurement` IDs — never re-resolved at replay time.

### `semanticResultKey` — the 4-part replacement domain

```
semanticResultKey = (targetId, outputQuantityType, semanticCategory, calculationScope)
```

Supersession (via `supersedesDerivedMeasurementId`) is permitted **only within an identical `semanticResultKey`**. This is deliberately 4-part, not the 2-part `(targetId, outputQuantityType)` shorthand — the shorter key would let a legitimate `NET_AREA` result (from `GROSS_MINUS_OPENINGS`) wrongly compete with a legitimate `RAW_AREA` result (from `POLYGON_AREA`) for the same target, or let two different aggregate purposes landing on the same summary node collide. With the full key: gross and net area never supersede each other; different `calculationScope`s never supersede each other; different `semanticCategory`s never collide. Exactly one canonical current chain exists per `semanticResultKey`.

**`calculationScope` — narrowest stable representation.** For single-target formulas (`RECTANGLE_AREA`, `POLYGON_AREA`, `VOLUME`, `GROSS_MINUS_OPENINGS`, `POLYLINE_LENGTH`), `calculationScope` is a fixed, degenerate value equal to the subject `targetId` itself — there is no meaningful scope choice to record. For aggregate formulas (`AGGREGATE_SUM`, `DEFECT_AREA_TOTAL`, `DEFECT_LENGTH_TOTAL`), `calculationScope` captures **both** the declared scope identifier (the shared `parentTargetId`, or the canonical `buildingId + explicit source targetType` encoding already required by the compatibility rule above) **and** the exact canonical set of source input IDs actually included at computation time — pinned once, at creation. This second part matters because "all ROOMs under APARTMENT_UNIT X" is a moving target as rooms are added or retired; pinning the exact resolved set at the moment of computation is what makes the aggregate itself reproducible, not just its formula and scope label.

- "Current" resolution = the leaf of the `supersedesDerivedMeasurementId` chain within one `semanticResultKey`. Never resolved by `createdAt` recency.
- Historical replay always uses the pinned `DerivedMeasurement` ID a `ReportSnapshot` already recorded — never a live re-resolution of "current."
- `overlapReviewedBy`/`overlapReviewedAt`/`overlapRiskNoted` are written atomically with the result at creation — never edited afterward. `overlapRiskNoted`, when set, propagates transitively downstream exactly like the assumed-input flag.
- **No independent trust/status field exists on `DerivedMeasurement`.** Its provenance and trust characteristics (assumed-input, overlap-risk) are always read from its pinned inputs at query time, never stored/updated on the row itself.

### `GROSS_MINUS_OPENINGS` — host/openings structural split

`GROSS_MINUS_OPENINGS`'s inputs are not a homogeneous set like `AGGREGATE_SUM`/`DEFECT_*_TOTAL` — they are one gross-area **host** plus a set of opening-area **openings**, two structurally distinct roles that must be resolvable without inference. This is carried by a dedicated field, not by shape or position within the shared list:

- **`grossSourceDerivedMeasurementId`** — pins the exact single gross-area host source. **Required** when `formulaType === GROSS_MINUS_OPENINGS`; **forbidden** (absent) for every other `formulaType`. Set once at creation, immutable, resolved by exact id only — never re-resolved to "current," identical discipline to every other pinned reference on `DerivedMeasurement`.
- **`inputDerivedMeasurementIds`**, for `GROSS_MINUS_OPENINGS` specifically, holds the **opening sources only** — the host is never also listed here. This is not a new kind of ambiguity: `VOLUME` already populates this same shared field with a single, differently-meaning entry (its one pinned area-result), so a shared input-list field's populated meaning being `formulaType`-dependent is an existing pattern, not a departure from one.

Write-time validation (`DerivedMeasurement` creation):

| Role | Identity | Target | Quantity/category |
|---|---|---|---|
| Host (`grossSourceDerivedMeasurementId`) | must exist; must not also appear in `inputDerivedMeasurementIds` | `grossSource.targetId === record.targetId`; that target's `targetType ∈ {FACADE, ROOF}` | `outputQuantityType === AREA`; `semanticCategory === RAW_AREA` |
| Each opening (`inputDerivedMeasurementIds[i]`) | must exist; list non-empty; no duplicate source `targetId` (Dedup Rule, below) | resolved target's `targetType === OPENING`; that target's `parentTargetId === record.targetId` (same-host compatibility, via existing `SpatialTarget` containment — no new field needed for this part) | `outputQuantityType === AREA` |

- **Same-building compatibility is not an independently-checked rule here** — it follows from the `parentTargetId` check above, provided the `SpatialTarget` write path continues to reject a cross-building `parentTargetId` the way it currently does. Note precisely what is and isn't frozen-doc text: `PERSISTENCE_AND_IMMUTABILITY.md`/`DOMAIN_MODEL.md` state a same-`buildingId` requirement explicitly only for `replacesTargetIds` (lineage) — the equivalent guarantee for `parentTargetId` (containment) exists today only as an implementation behavior, not as an explicit architecture-doc sentence. This subsection relies on that behavior continuing to hold; it does not itself establish or freeze a new `parentTargetId` cross-building rule, and no independent `buildingId` comparison is added here.
- **Historical/superseded sources are permitted for both roles.** `GROSS_MINUS_OPENINGS` does **not** require the host or any opening to be the current, unsuperseded leaf of its own chain at creation time — exact pinned ids are valid if explicitly selected, exactly as already true (silently) for `AGGREGATE_SUM`/`DEFECT_*_TOTAL`'s sources. "Current" stays a derived, read-time-only concept; it is never a write-time gate and never auto-substituted.
- **Overlap-acknowledgement input count** (see "Dedup & Overlap Rules" below) is `1 (host) + inputDerivedMeasurementIds.length (openings)` for this `formulaType` — not the openings list alone.

## Assumed-Input Policy

| formulaType | Policy |
|---|---|
| RECTANGLE_AREA | Conditionally allowed — an input may be `SYSTEM_ASSUMED` with mandatory `assumptionReason`; **not all** required inputs may be assumed simultaneously (at least one must be a real observation) |
| POLYGON_AREA | Forbidden — captured geometry must be actually measured |
| VOLUME | Conditionally allowed, same "not all inputs assumed" rule as RECTANGLE_AREA |
| POLYLINE_LENGTH | Forbidden, same reasoning as POLYGON_AREA |
| GROSS_MINUS_OPENINGS / AGGREGATE_SUM / DEFECT_*_TOTAL | Conditionally allowed, **inherited only** — these formulas never originate a new assumption; they only ever transitively inherit `derivedFromAssumedInput` from their pinned inputs |

**Assumed-input provenance propagates transitively**, recursively, to arbitrary depth: any `DerivedMeasurement` whose input set includes any Measurement or DerivedMeasurement flagged as assumption-derived must itself carry the flag, all the way through to `ReportSnapshot` rendering. No silent defaults anywhere in the chain. For `GROSS_MINUS_OPENINGS` specifically, "input set" for this purpose means the full pinned set — `grossSourceDerivedMeasurementId` **and** every entry in `inputDerivedMeasurementIds` — not the openings list alone; the host is exactly as capable of carrying an inherited assumed-input or overlap-risk flag as any opening is.

## Dedup & Overlap Rules (for list-input formulas)

- **Dedup by underlying source `targetId`**, never by `DerivedMeasurement` row ID — an aggregate's input set may include at most one `DerivedMeasurement` per source `targetId` (resolved to the current one, per `semanticResultKey`, before the dedup check).
- **Overlap acknowledgement is mandatory**, not merely operator-initiated, whenever `GROSS_MINUS_OPENINGS`, `AGGREGATE_SUM`, or `DEFECT_AREA_TOTAL` combine 2 or more spatially-relevant inputs — the calculation cannot complete without a recorded acknowledgement (who reviewed, when, which inputs). For `GROSS_MINUS_OPENINGS`, the spatially-relevant input count is `1 (grossSourceDerivedMeasurementId, the host) + inputDerivedMeasurementIds.length (the openings)` — a host plus a single opening is already 2 and already requires acknowledgement; the count is never computed from the openings list alone. The acknowledgement does **not** assert absence of overlap — only that a human reviewed the input set; no geometric overlap-detection algorithm is introduced. `DEFECT_LENGTH_TOTAL` does not require this (linear-defect double-counting is a duplicate-identity problem, already covered by the dedup rule above, not a true overlap problem).
