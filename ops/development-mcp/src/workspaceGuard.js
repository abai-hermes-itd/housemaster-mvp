'use strict';

const fs = require('fs');
const path = require('path');
const { runGit } = require('./git');
const { makeError } = require('./errors');

/**
 * Workspace guard (MCP-D02, section 6).
 * Read-only. Never checks out, repairs, or mutates anything. If the
 * canonical workspace/repo/branch does not match exactly, it returns a
 * BLOCKED-shaped error for the caller to wrap in the common envelope.
 */
const CANONICAL_WORKSPACE = 'C:\\Users\\M A R A T\\Documents\\HOUSEMASTER_CAMERA';
const EXPECTED_REPO_SLUG = 'abai-hermes-itd/housemaster-mvp';
const EXPECTED_BRANCH = 'main';

function normalize(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

/**
 * Extracts "owner/repo" from a github remote URL, https or ssh form.
 * Pure function — no I/O — kept exported for isolated self-testing.
 */
function extractRepoSlug(remoteUrl) {
  const match = String(remoteUrl || '').match(/github\.com[:/]+([^/]+\/[^/]+?)(\.git)?$/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * checkWorkspace(candidatePath) -> { ok: true, facts } | { ok: false, error }
 * Read-only: runs only rev-parse / remote / status through the allowlisted
 * git runner. Never writes, never checks out, never repairs.
 */
function checkWorkspace(candidatePath) {
  const resolved = path.resolve(candidatePath || process.cwd());

  if (normalize(resolved) !== normalize(CANONICAL_WORKSPACE)) {
    return {
      ok: false,
      error: makeError(
        'OUTSIDE_WORKSPACE_ACCESS',
        'Resolved path is outside the canonical Development MCP workspace.',
        { resolved, expected: CANONICAL_WORKSPACE },
        false
      ),
    };
  }

  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      error: makeError('WORKSPACE_NOT_FOUND', 'Canonical workspace path does not exist.', { resolved }, false),
    };
  }

  if (!fs.existsSync(path.join(resolved, '.git'))) {
    return {
      ok: false,
      error: makeError('NOT_GIT_REPOSITORY', 'Canonical workspace has no .git directory.', { resolved }, false),
    };
  }

  let remoteUrl;
  try {
    remoteUrl = runGit(['remote', 'get-url', 'origin'], resolved);
  } catch (e) {
    return {
      ok: false,
      error: makeError('GIT_COMMAND_FAILED', 'Could not read origin remote URL.', { message: e.message }, false),
    };
  }

  const slug = extractRepoSlug(remoteUrl);
  if (slug !== EXPECTED_REPO_SLUG) {
    return {
      ok: false,
      error: makeError(
        'WRONG_REPOSITORY',
        'Origin remote does not match the canonical repository.',
        { remoteUrl, expected: EXPECTED_REPO_SLUG, found: slug },
        false
      ),
    };
  }

  let branch;
  try {
    branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolved);
  } catch (e) {
    return {
      ok: false,
      error: makeError('GIT_COMMAND_FAILED', 'Could not read current branch.', { message: e.message }, false),
    };
  }

  if (branch !== EXPECTED_BRANCH) {
    return {
      ok: false,
      error: makeError(
        'WRONG_BRANCH',
        'Current branch does not match the expected branch. No automatic checkout was performed.',
        { branch, expected: EXPECTED_BRANCH },
        true
      ),
    };
  }

  let headSha;
  let porcelain;
  try {
    headSha = runGit(['rev-parse', 'HEAD'], resolved);
    porcelain = runGit(['status', '--porcelain'], resolved);
  } catch (e) {
    return {
      ok: false,
      error: makeError('GIT_COMMAND_FAILED', 'Could not read HEAD or working tree status.', { message: e.message }, false),
    };
  }

  return {
    ok: true,
    facts: {
      workspace: resolved,
      remoteUrl,
      repoSlug: slug,
      branch,
      headSha,
      clean: porcelain.length === 0,
      dirtyEntries: porcelain.length ? porcelain.split('\n') : [],
    },
  };
}

module.exports = {
  checkWorkspace,
  extractRepoSlug,
  CANONICAL_WORKSPACE,
  EXPECTED_REPO_SLUG,
  EXPECTED_BRANCH,
};
