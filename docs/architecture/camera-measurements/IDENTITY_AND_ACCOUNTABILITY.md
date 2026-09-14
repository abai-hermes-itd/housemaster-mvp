# Identity & Accountability — Camera Measurements MVP

Authoritative source: GATE-0C/HG-3 and its Codex/fix pass.

This is **not** an IAM/SSO design and **not** a role-management system. It is the minimum stable identity contract the frozen architecture needs to guarantee that every authoritative write has a resolvable, accountable, non-recyclable actor behind it, and that an AI/Guide system can never silently cross into authoritative state.

## `ActorRef`

```
actorId · actorType · displayName · externalSubjectRef · status
```

| Field | Required? | Immutable? | Purpose |
|---|---|---|---|
| `actorId` | required | yes | Stable, non-recyclable domain identity — the only thing any provenance field stores |
| `actorType` | required | yes (set once at creation) | Distinguishes human accountability from automated proposal authorship |
| `displayName` | required | no (live) | Current best-known presentation name; resolved live everywhere **except** `ReportSnapshot`, which pins its own copy at issuance |
| `externalSubjectRef` | optional | becomes immutable the instant first populated (no relinking in MVP); must be unique across all `ActorRef` rows when set; must be an opaque, non-PII identifier (e.g., an OIDC-style `sub`, never a raw email) | Reserved pointer to a future external auth/SSO subject — decouples domain-stable identity from whatever auth system exists now or later |
| `status` | required | no (`ACTIVE ↔ INACTIVE`, bidirectional) | Lifecycle flag restricting *future* assignment; never invalidates past references |

`ActorRef` carries **no email, phone, or credential fields** — that belongs to a future user-directory/profile system resolving `actorId`/`externalSubjectRef` outward, entirely outside this MVP's boundary. Domain records reference `actorId` only, never a name or contact detail directly.

**Identity source**: hybrid local `actorId` + optional `externalSubjectRef`. No external auth is required for MVP; `externalSubjectRef` stays null until (if ever) real SSO/IAM exists, with zero schema change needed at that point.

**No hard deletion of a referenced `ActorRef`, ever.** Historical validity never depends on an actor's *current* status — an `INACTIVE` actor's past `Decision`s, corrections, and captures remain exactly as valid and resolvable as before deactivation; only new assignment/authorship is blocked going forward. `INACTIVE ↔ ACTIVE` is bidirectional — reactivation reuses the same `actorId`, never mints a new one.

## `actorType` Enum

```
HUMAN_OPERATOR
AGENT
```

Only two values. `SYSTEM`, `IMPORT_PROCESS`, `DEVICE`, and `ORGANIZATION` were each explicitly reviewed and excluded:

- **No `SYSTEM` actor.** A deterministic computation (`DerivedMeasurement`) needs no actor at all — its provenance is already fully and more precisely captured by its pinned formula version and input IDs. Attributing it to a "SYSTEM" placeholder would be decorative, not load-bearing.
- **No `IMPORT_PROCESS` actor.** Every MVP import is triggered by a human clicking "import" — the actor is that `HUMAN_OPERATOR`; the import's distinct nature is captured by `entryMethod = IMPORTED_HISTORIC` + `sourceRef`. An unattended, out-of-band bulk load bypassing the application is explicitly unsupported for MVP.
- **`DEVICE` is not an actor.** A camera/phone doesn't make a choice — it's equipment used by an operator, already correctly modeled as `CalibrationSession.deviceRef` (equipment/execution provenance, not agency).
- **`ORGANIZATION` is not an actor.** An organization doesn't perform actions; a person within it does. Tenancy/scoping is deferred entirely.

**`AGENT` is a classification, not a single shared identity.** Each conceptually distinct automated system (today's Guide, a future different AI subsystem, a future MCP-driven agent) receives its own stable `ActorRef` row under `actorType = AGENT`, exactly as every human operator gets their own row under `HUMAN_OPERATOR`. The specific model/version/tool-call/session that produced any one `Proposal` is **execution provenance**, captured on the `Proposal` record itself — never on `ActorRef`, which identifies only *which* system proposed something.

## The Human Accountability Boundary

**Every supported nondeterministic authoritative write has a responsible `HUMAN_OPERATOR`.** `AGENT` may author a `Proposal` — and nothing else. It is never a valid actor for a `Decision`, a correction, a retirement, a calibration, evidence creation, an overlap review, or a report issuance.

### Action → Actor Requirement

| Action | actorId | Valid actorType |
|---|---|---|
| Create SpatialTarget | REQUIRED | HUMAN_OPERATOR |
| Retire SpatialTarget | REQUIRED | HUMAN_OPERATOR |
| Create SurveyAssignment | REQUIRED | HUMAN_OPERATOR |
| Mark ScopeItem complete/skipped | REQUIRED | HUMAN_OPERATOR |
| MeasurementSession (open/close) | REQUIRED | HUMAN_OPERATOR |
| Create Measurement | REQUIRED | HUMAN_OPERATOR (never AGENT, even via an accepted Proposal) |
| Correct Measurement | REQUIRED | HUMAN_OPERATOR |
| Create DerivedMeasurement | **NOT_APPLICABLE** | — (deterministic; provenance is the pinned formula+input record) |
| Calibrate | REQUIRED | HUMAN_OPERATOR |
| Create Evidence | REQUIRED | HUMAN_OPERATOR (never AGENT) |
| Submit Proposal | REQUIRED | HUMAN_OPERATOR **or** AGENT |
| Decision | REQUIRED | HUMAN_OPERATOR **only** |
| Overlap review | REQUIRED | HUMAN_OPERATOR **only** |
| Issue ReportSnapshot | REQUIRED | HUMAN_OPERATOR |

### Accepted-Proposal Attribution

When an authoritative record (a `Measurement`, `Evidence`, or any other write) is created as the direct result of an **accepted** `Proposal`, its `actorId` is always the `HUMAN_OPERATOR` who made the accepting `Decision` — **never** the `AGENT` that authored the originating `Proposal`. The AI's involvement remains fully traceable via `Decision.proposalId → Proposal.author`, a separate, permanent link — it is never represented as the resulting record's own actor. This is the concrete mechanism that keeps "AI recommendation" and "authoritative engineering fact" from being conflated even after acceptance.

### Provenance chain

```
Proposal (author: HUMAN_OPERATOR or AGENT, immutable)
  → Decision (actor: HUMAN_OPERATOR only, immutable, links to Proposal)
    → resulting authoritative record (actor: the accepting HUMAN_OPERATOR)
```

Every link in this chain is append-only and immutable — `result → Decision → Proposal` provenance can be traced forever, and none of the three records is ever edited after creation.

## Execution Provenance vs. Actor Identity

Execution provenance (which formula version computed a result, which device calibration was used, which specific model/tool-call produced a Proposal) is always kept **separate** from `ActorRef`. `ActorRef` answers "who is accountable"; the entity being acted on (`FormulaDefinition`, `CalibrationSession`, `Proposal`'s own context field) answers "how, specifically, was this produced." Conflating the two would either force execution detail onto a stable identity record (making `ActorRef` need versioning it was never meant to carry) or force identity onto a fact record (making a deterministic computation need an actor it doesn't have).
