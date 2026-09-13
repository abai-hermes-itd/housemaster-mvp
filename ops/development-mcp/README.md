# Development MCP v0.1 — FROZEN (MCP-D05)

**This is Development MCP only. It is NOT the HouseMaster Product MCP.**

Scope: read-only technical execution helpers for gate reviewers (workspace/
repo/branch facts, scope-boundary checks, diff summaries, aggregated gate
reports). It defines no product entities and does not touch Measurement,
Geometry/Topology, Building/Cadastre/Map, UX flow, report architecture, or
Voice Guide architecture.

## FREEZE STATUS = FROZEN (MCP-D05)

Development MCP v0.1 is frozen as of MCP-D05. MCP-D01 (concept) →
MCP-D02 (skeleton) → MCP-D03 (hardening) → MCP-D04 (local trial, 46/46
tests, 0 files changed) are all CLOSED/PASS. No further feature work,
new tools, or behavior changes occur under the v0.1 label.

**Frozen tools (exactly four, no fifth):**
`hm_repo_status`, `hm_scope_check`, `hm_diff_summary`, `hm_gate_report`

**Frozen boundaries:**
- Read-only process control only — no mutation of git, the filesystem
  outside its own package, or any external system.
- No architecture authority — reports facts, never decides design.
- No commit / push / deploy capability of any kind.
- No next-gate authority — `hm_gate_report` never returns `APPROVED` or
  `START_NEXT_GATE`; `requiresHumanApproval` is always `true`.
- Human approval remains required for every gate decision.
- The HouseMaster **Product MCP** (MCP-ready boundary per CM-S13-A) is a
  separate, not-yet-started effort — this package has no relationship to
  it beyond sharing the word "MCP".

**Known v0.1 limitation (non-blocking, not fixed under v0.1):**
`hm_scope_check` accepts a `baselineRef` input, but its working-tree
change derivation uses `git status --porcelain`, which is inherently
HEAD-relative. `baselineRef=HEAD` is therefore validated and supported;
arbitrary non-HEAD baseline semantics are **not** claimed or implemented.
See MCP-D04 trial notes for the observation that exposed this.

## Status (history)

MCP-D02: skeleton (registry, envelope, error model, workspace guard,
schemas, 4 tools registered). MCP-D03: hardened the same four tools'
implementations and added a validator test suite — no architecture
change, no new tools, no transport added. Zero runtime dependencies
(pure Node.js core modules — no `npm install` required, not required
in D03 either). No network listener, no stdio/JSON-RPC transport wired
yet — deferred to a future, separately-approved gate, **not started**.

### MCP-D03 hardening notes

- `hm_repo_status` data gained `repoRoot`, `remoteFetch`, `remotePush`,
  `ahead`/`behind`, `workingTreeClean`, `trackedChangeCount`,
  `untrackedCount`, `stagedCount`, `detachedHead`, `status` — additive;
  the MCP-D02 fields (`clean`, `dirtyEntries`, `remoteUrl`, `repoSlug`)
  are kept for backward compatibility.
- `hm_scope_check` keeps its MCP-D02 `{paths, allowedPrefixes}` legacy
  mode byte-for-byte, and adds a hardened contract
  (`allowedFiles`/`allowedDirectories`/`forbiddenFiles`/`forbiddenDirectories`/
  `allowUntracked`/`baselineRef`/`gateId`) that self-derives
  staged/unstaged/untracked changes from git. **Forbidden always wins
  over allowed**, and `index.html` / `.git/` are hard-forbidden and
  cannot be overridden by caller input.
- `hm_diff_summary` gained added/modified/deleted/renamed classification,
  insertion/deletion counts, binary-file detection, a non-throwing
  `git diff --check` result, and risk flags (`LARGE_DIFF`,
  `BINARY_CHANGE`, `DELETION`, `CONFIG_CHANGE`, `DEPENDENCY_CHANGE`,
  `GENERATED_FILE_CHANGE`, `FORBIDDEN_PATH_TOUCH`, `UNEXPECTED_RENAME`).
  `baseRef` (D02) and `baselineRef` (D03) are both accepted.
- `hm_gate_report` now returns `technicalVerdict` (PASS/BLOCKED/ERROR)
  and `nextAction` (`RETURN_TO_ARCHITECT_REVIEW` / `FIX_CURRENT_GATE` /
  `HUMAN_APPROVAL_REQUIRED`), resolved by a strict precedence order —
  SECURITY BLOCK > WORKSPACE BLOCK > SCOPE BLOCK > TEST BLOCK > WARNING
  > PASS — and asserts at runtime that it can never emit `APPROVED` or
  `START_NEXT_GATE`. It now also calls `hm_scope_check` internally and
  accepts an optional caller-supplied `testStatus` (this MCP does not
  run product tests itself).
- `git.js` allowlist gained `rev-list` (as read-only as the already
  allowed `log`; needed for ahead/behind) and a non-throwing
  `runGitSafe` runner for commands like `diff --check` that legitimately
  exit non-zero on a result, not a failure. No mutating subcommand was
  added.

## Layout

```
ops/development-mcp/
  package.json
  README.md
  src/
    server.js            entrypoint — registers exactly 4 tools
    toolRegistry.js       in-process tool registry
    envelope.js           common result envelope (frozen shape)
    errors.js             standard error model (frozen code list)
    git.js                allowlisted, read-only git runner
    workspaceGuard.js      canonical workspace/repo/branch guard
    tools/
      hmRepoStatus.js
      hmScopeCheck.js
      hmDiffSummary.js
      hmGateReport.js
  schemas/
    hm_repo_status.schema.json
    hm_scope_check.schema.json
    hm_diff_summary.schema.json
    hm_gate_report.schema.json
  test/
    selfTest.js            MCP-D02 skeleton self-test (7 checks)
    d03Validators.test.js  MCP-D03 validator suite (S1-S8, D1-D6, G1-G6, A-E)
```

## Registered tools (exactly four)

- `hm_repo_status` — reports workspace/branch/HEAD/clean-state facts.
- `hm_scope_check` — classifies supplied file paths as inside/outside an
  allowed boundary (string comparison only, touches no files).
- `hm_diff_summary` — read-only `git diff` facts vs a base ref.
- `hm_gate_report` — aggregates the above into one technical report for a
  human reviewer. **Never decides CONSENSUS, never starts a gate, and
  never returns an "APPROVED" status** — `requiresHumanApproval` is always
  `true` on this tool's output.

## Common envelope

Every tool call returns exactly:

```
tool, version, timestamp, workspace, gateId,
status ("PASS" | "BLOCKED" | "ERROR" — never "APPROVED"),
summary, data, warnings[], errors[], requiresHumanApproval
```

See `src/envelope.js`.

## Error model

Exactly: `WORKSPACE_NOT_FOUND`, `NOT_GIT_REPOSITORY`, `WRONG_REPOSITORY`,
`WRONG_BRANCH`, `DIRTY_BASELINE`, `SCOPE_VIOLATION`, `GIT_COMMAND_FAILED`,
`DIFF_CHECK_FAILED`, `TEST_FAILED`, `INVALID_TOOL_INPUT`,
`OUTSIDE_WORKSPACE_ACCESS`. See `src/errors.js`.

## Workspace guard

Canonical workspace: `C:\Users\M A R A T\Documents\HOUSEMASTER_CAMERA`
Expected repository: `abai-hermes-itd/housemaster-mvp`
Expected branch: `main`

The guard never auto-repairs a mismatch (no checkout, no reset) — it only
reports `WRONG_REPOSITORY` / `WRONG_BRANCH` / etc. for a human to act on.

## Security boundary

`src/git.js` is the only place this server ever shells out to git, and it
enforces a hard allowlist: `rev-parse`, `remote`, `status`, `diff`,
`branch`, `log`, `rev-list`. There is no code path capable of `add`, `commit`, `push`,
`pull`, `reset`, `clean`, `checkout`, `switch`, `merge`, or `rebase`, and no
generic shell-command wrapper exists anywhere in this package. No Plesk,
DNS, GitHub-settings, deployment, or credential/secret code exists here.

## Running

```
node src/server.js      # prints registered tool names, exits
npm run selftest        # MCP-D02 skeleton self-test
npm run validators      # MCP-D03 validator suite
npm test                # both, in sequence
```

No dependency installation is required or was performed for this skeleton
or its MCP-D03 hardening.
