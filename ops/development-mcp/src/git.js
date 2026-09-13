'use strict';

const { execFileSync, spawnSync } = require('child_process');

/**
 * SECURITY BOUNDARY (MCP-D02 section 8 / MCP-D03 section 7):
 * This is the ONLY place in Development MCP that ever shells out to git,
 * and it enforces a hard allowlist of read-only subcommands. There is no
 * code path anywhere in this server that can reach:
 *   add, commit, push, pull, reset, clean, checkout, switch, merge, rebase
 * Arguments are always passed as an array to execFileSync/spawnSync
 * (never through a shell string, and no shell option of any kind is
 * enabled), so there is no shell-injection surface and no generic
 * "run arbitrary command" wrapper.
 *
 * MCP-D03 addition: `rev-list` was added to the allowlist. It is exactly
 * as read-only as `log` (which was already allowed) — it only lists /
 * counts commits — and is needed for ahead/behind counts in
 * hm_repo_status. No new subcommand family (add/commit/etc.) was
 * introduced.
 */
const ALLOWED_SUBCOMMANDS = Object.freeze(
  new Set(['rev-parse', 'remote', 'status', 'diff', 'branch', 'log', 'rev-list'])
);

function assertAllowed(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('git args require a non-empty argument array.');
  }
  const [subcommand] = args;
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new Error(
      `BLOCKED_GIT_SUBCOMMAND: "${subcommand}" is not on the Development MCP read-only allowlist.`
    );
  }
}

/** Throws on non-zero exit (use for calls where failure is a genuine error). */
function runGit(args, cwd) {
  assertAllowed(args);
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/**
 * Never throws on non-zero exit — returns { status, stdout, stderr } instead.
 * Needed for commands like `git diff --check`, which legitimately exits
 * non-zero when it finds whitespace/conflict-marker issues; that is a
 * result to report, not a process failure. Still subcommand-allowlisted
 * and still argv-array only (no shell).
 */
function runGitSafe(args, cwd) {
  assertAllowed(args);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

module.exports = { runGit, runGitSafe, ALLOWED_SUBCOMMANDS };
