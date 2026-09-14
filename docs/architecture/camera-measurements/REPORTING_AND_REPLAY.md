# Reporting & Historical Replay — Camera Measurements MVP

Authoritative source: R3A/R3B report-reproducibility findings, GATE-0D/HG-4 and its Codex/fix pass (CDX4-05, CDX4-09).

## Report vs. ReportSnapshot

**`Report`** — `MUTABLE_OPERATIONAL_STATE`. A live, ongoing container across its entire life. May be issued **multiple times**; each issuance produces a new `ReportSnapshot`. Holds an append-only `withdrawalRecords[]` (see below). Changing which `ScopeItem`s a `Report` covers, or its own `status`, never touches any previously-issued `ReportSnapshot`.

**`ReportSnapshot`** — `IMMUTABLE_SNAPSHOT`. The frozen, point-in-time artifact produced at each issuance.

- **Zero writable fields after creation. No exception, not even a narrow one.**
- **Never regenerated under the same `snapshotId`.** Re-issuing after a correction always produces a distinct new snapshot (a new version under the same `Report`), never an edit of an existing one.
- **Historical rendering never resolves live fields.** Everything a snapshot displays is what it pinned at issuance — never a live join back to current `Measurement`, `Geometry`, `ActorRef`, or `Building` state.

## What `ReportSnapshot` Pins at Issuance

| Pinned reference | Why |
|---|---|
| Exact `Measurement` IDs used | The raw facts behind every reported figure |
| Exact `Geometry` `(geometryId, version)` composites | Never "current geometry" — the specific captured shape used |
| Exact `DerivedMeasurement` IDs | The specific computed results used, resolved through their own pinned formula+input references |
| The `FormulaDefinition` version(s) behind those results, through the pinned `DerivedMeasurement`s' own derivation | Reproducibility of the calculation itself |
| Exact `Evidence` IDs | The photographic/documentary basis, unaffected by any later replacement |
| `actorId` for every provenance role rendered (who measured, corrected, calibrated, decided, reviewed, issued) | Stable domain identity |
| `actorDisplayNameAtIssuance` | The name as it was at issuance — protects against a later account rename silently altering an issued report's presented attribution |
| `buildingId` | The stable domain identity of the building surveyed |
| `buildingNameAtIssuance`, `buildingAddressAtIssuance` | The building's identifying details as they were at issuance — protects against a later address/name correction silently altering an issued report's presented content, exactly the same reasoning as the actor-name pin |

**When available** (not a required MVP field, and not currently part of the frozen entity set): a cadastral or map-feature reference, and the provenance/status of any pinned item exactly as known at issuance. **`buildingId` remains the stable domain identity in all cases — an external cadastral/map reference is never promoted above it.** No `cadastralRef`/`mapFeatureId` field exists anywhere in this architecture today; nothing here requires adding one, and none should be added without a proven MVP need and a new review gate.

Everything **not** in this list — locale, number formatting, decimal separators, template/layout choice, the rendering application's version — is explicitly **pixel-identical document reproducibility**, not **data reproducibility**, and is out of MVP scope. `ReportSnapshot`'s guarantee is that the underlying facts and figures never change; it does not guarantee a byte-identical rendered PDF across template revisions.

## Withdrawal

A report may need to be marked as no longer relied upon (e.g., a serious error discovered after issuance). This is represented **entirely on `Report`**, never on `ReportSnapshot`:

```
Report.withdrawalRecords[]   — append-only, never edited or removed
  each entry: { snapshotId, withdrawnAt, withdrawnBy, withdrawalReason }
```

Rules:
- **Appended only.** A withdrawal record is never edited or deleted once written.
- **Never mutates `ReportSnapshot`.** The withdrawn snapshot's own content is completely untouched.
- **Never deletes the historical snapshot.** A withdrawn `ReportSnapshot` remains fully, permanently resolvable by its own ID — withdrawal is a statement about current reliance, not an erasure.
- **One effective withdrawal per snapshot.** Withdrawal is one-way and terminal — there is no "un-withdraw." If a withdrawal was itself a mistake, the remedy is issuing a fresh, valid `ReportSnapshot`, keeping the audit trail unambiguous.
- **Human attribution required.** `withdrawnBy` must be a `HUMAN_OPERATOR` — withdrawing a report is a consequential, accountable act, not something `AGENT` may do.
- **Current usability is derived**, never stored on the snapshot: "is this snapshot still relied upon" is a query against `Report.withdrawalRecords[]`, entirely separate from the snapshot's own immutable content.

## Why This Split, Specifically

The temptation is to add a `withdrawn` flag directly to `ReportSnapshot` — it seems narrow and harmless. It is rejected deliberately: `ReportSnapshot` is the *one* entity in this entire architecture whose sole reason for existing is an absolute, unconditional immutability guarantee (invariant #12). Every other mutable-status field in this model (`SpatialTarget.status`, `ActorRef.status`, `FormulaDefinition`'s derived eligibility, `CalibrationSession`'s derived eligibility) belongs to an entity that was never claimed to be 100% immutable in the first place. Adding even one exception to `ReportSnapshot`'s guarantee — however well-reasoned — creates a precedent for a second, then a third. `Report` already exists, is already mutable by design, and is exactly the right home for "the current state of which of my issued snapshots remain valid." No new entity, and a *stronger*, not weaker, guarantee on the one entity that matters most.
