'use strict';

const path = require('path');
const { buildEnvelope } = require('../envelope');
const { makeError } = require('../errors');
const { checkWorkspace } = require('../workspaceGuard');
const { runGit } = require('../git');

const TOOL_NAME = 'hm_scope_check';

// Default boundary matches MCP-D02's own file boundary.
const DEFAULT_ALLOWED_DIRECTORIES = ['ops/development-mcp/'];

// Hard-forbidden paths that NO caller input can override, regardless of
// allowedFiles/allowedDirectories. This backs MCP-D03 section 2's fixed
// boundary (index.html / product code / git internals) independent of
// whatever a given gate's caller-supplied rules say. Forbidden always wins.
const HARD_FORBIDDEN_FILES = Object.freeze(['index.html']);
const HARD_FORBIDDEN_DIRECTORIES = Object.freeze(['.git/']);

function normalizeRel(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Resolves a caller-supplied relative path against the workspace root and
 * reports whether it escapes the workspace (path traversal / absolute
 * path elsewhere). Pure, does no I/O.
 */
function isOutsideWorkspace(workspace, relPath) {
  const resolved = path.resolve(workspace, relPath);
  const normalizedWorkspace = path.resolve(workspace).replace(/[\\/]+$/, '').toLowerCase();
  const normalizedResolved = resolved.replace(/[\\/]+$/, '').toLowerCase();
  return !(
    normalizedResolved === normalizedWorkspace || normalizedResolved.startsWith(normalizedWorkspace + path.sep)
  );
}

/**
 * classifyPaths: pure classification engine — no git, no filesystem
 * mutation. Exported so MCP-D03's S1-S8 test cases can exercise it
 * directly and deterministically.
 *
 * @param {string} workspace          absolute canonical workspace path
 * @param {{path:string, untracked?:boolean}[]} files   files to classify
 * @param {object} rules              { allowedFiles, allowedDirectories, forbiddenFiles, forbiddenDirectories, allowUntracked }
 * @returns {{allowedChanges:string[], violations:{path:string, reason:string, errorCode:string}[]}}
 */
function classifyPaths(workspace, files, rules) {
  const allowedFiles = (rules.allowedFiles || []).map(normalizeRel);
  const allowedDirectories = (rules.allowedDirectories && rules.allowedDirectories.length
    ? rules.allowedDirectories
    : DEFAULT_ALLOWED_DIRECTORIES
  ).map(normalizeRel);
  const forbiddenFiles = [...HARD_FORBIDDEN_FILES, ...(rules.forbiddenFiles || [])].map(normalizeRel);
  const forbiddenDirectories = [...HARD_FORBIDDEN_DIRECTORIES, ...(rules.forbiddenDirectories || [])].map(
    normalizeRel
  );
  const allowUntracked = rules.allowUntracked !== false; // default true

  const allowedChanges = [];
  const violations = [];

  for (const entry of files) {
    const rel = normalizeRel(entry.path);

    // Rule 0: path traversal / outside-workspace always loses, no exceptions.
    if (rel.includes('..') || (workspace && isOutsideWorkspace(workspace, rel))) {
      violations.push({ path: rel, reason: 'PATH_ESCAPES_WORKSPACE', errorCode: 'OUTSIDE_WORKSPACE_ACCESS' });
      continue;
    }

    // Rule 1: untracked-not-allowed always loses, before path rules.
    if (entry.untracked && !allowUntracked) {
      violations.push({ path: rel, reason: 'UNTRACKED_NOT_ALLOWED', errorCode: 'SCOPE_VIOLATION' });
      continue;
    }

    // Rule 2 (hard rule): FORBIDDEN always has precedence over ALLOWED.
    const forbiddenByFile = forbiddenFiles.includes(rel);
    const forbiddenByDir = forbiddenDirectories.some((prefix) => rel.startsWith(prefix));
    if (forbiddenByFile || forbiddenByDir) {
      violations.push({ path: rel, reason: 'FORBIDDEN_PATH', errorCode: 'SCOPE_VIOLATION' });
      continue;
    }

    // Rule 3: allowed if explicitly listed or under an allowed directory.
    const allowedByFile = allowedFiles.includes(rel);
    const allowedByDir = allowedDirectories.some((prefix) => rel.startsWith(prefix));
    if (allowedByFile || allowedByDir) {
      allowedChanges.push(rel);
      continue;
    }

    // Rule 4: not allowed, not forbidden by an explicit rule -> still a violation
    // (default-deny: anything outside the allowed boundary is out of scope).
    violations.push({ path: rel, reason: 'OUTSIDE_ALLOWED_SCOPE', errorCode: 'SCOPE_VIOLATION' });
  }

  return { allowedChanges, violations };
}

/**
 * gatherChangeSets: read-only git introspection producing
 * {staged, unstaged, untracked} relative-path arrays. No mutation.
 */
function gatherChangeSets(workspace) {
  const porcelain = runGit(['status', '--porcelain', '--untracked-files=all'], workspace);
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of porcelain.split('\n').filter(Boolean)) {
    const x = line[0];
    const y = line[1];
    const rawPath = line.slice(3);
    // Renames show as "old -> new"; use the new path.
    const filePath = rawPath.includes(' -> ') ? rawPath.split(' -> ')[1] : rawPath;
    if (x === '?' && y === '?') {
      untracked.push(filePath);
    } else {
      if (x !== ' ' && x !== '?') staged.push(filePath);
      if (y !== ' ' && y !== '?') unstaged.push(filePath);
    }
  }

  return { staged, unstaged, untracked };
}

/**
 * hm_scope_check — two supported input shapes:
 *
 * LEGACY (MCP-D02, kept byte-for-byte in behavior for regression safety):
 *   { paths: string[], allowedPrefixes?: string[] }
 *
 * MCP-D03 hardened contract:
 *   { workspacePath?, gateId?, allowedFiles?, allowedDirectories?,
 *     forbiddenFiles?, forbiddenDirectories?, allowUntracked?, baselineRef?,
 *     simulateChangedFiles? }   // simulateChangedFiles is test-only, see below
 */
function handle(input = {}, ctx = {}) {
  const workspace = (ctx && ctx.workspace) || process.cwd();
  const guard = checkWorkspace(workspace);

  if (!guard.ok) {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace,
      status: 'BLOCKED',
      summary: `Workspace guard failed: ${guard.error.errorCode}`,
      errors: [guard.error],
      requiresHumanApproval: true,
    });
  }

  // ── LEGACY MODE (unchanged from MCP-D02) ────────────────────────────
  if (input && Array.isArray(input.paths)) {
    if (input.paths.length === 0) {
      return buildEnvelope({
        tool: TOOL_NAME,
        workspace: guard.facts.workspace,
        status: 'ERROR',
        summary: 'Invalid input: "paths" (non-empty string[]) is required.',
        errors: [
          makeError('INVALID_TOOL_INPUT', 'input.paths must be a non-empty array of relative file paths.', { input }, true),
        ],
        requiresHumanApproval: false,
      });
    }

    const allowedPrefixes =
      Array.isArray(input.allowedPrefixes) && input.allowedPrefixes.length
        ? input.allowedPrefixes.map(normalizeRel)
        : DEFAULT_ALLOWED_DIRECTORIES;

    const inBoundary = [];
    const violations = [];
    for (const raw of input.paths) {
      const rel = normalizeRel(raw);
      const allowed = allowedPrefixes.some((prefix) => rel.startsWith(prefix));
      (allowed ? inBoundary : violations).push(rel);
    }

    const status = violations.length ? 'BLOCKED' : 'PASS';
    const errors = violations.length
      ? [makeError('SCOPE_VIOLATION', 'One or more paths fall outside the allowed boundary.', { violations, allowedPrefixes }, true)]
      : [];

    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status,
      summary: violations.length
        ? `${violations.length} path(s) violate the allowed boundary.`
        : 'All checked paths are within the allowed boundary.',
      data: { allowedPrefixes, inBoundary, violations },
      errors,
      requiresHumanApproval: violations.length > 0,
    });
  }

  // ── MCP-D03 HARDENED CONTRACT ────────────────────────────────────────
  const rules = {
    allowedFiles: input.allowedFiles,
    allowedDirectories: input.allowedDirectories,
    forbiddenFiles: input.forbiddenFiles,
    forbiddenDirectories: input.forbiddenDirectories,
    allowUntracked: input.allowUntracked,
  };

  let changeSets;
  if (input.simulateChangedFiles) {
    // Test-only deterministic input — see MCP-D03 test suite S1-S8. Never
    // used by the real git-backed path; lets tests avoid mutating the repo.
    changeSets = {
      staged: input.simulateChangedFiles.staged || [],
      unstaged: input.simulateChangedFiles.unstaged || [],
      untracked: input.simulateChangedFiles.untracked || [],
    };
  } else {
    try {
      changeSets = gatherChangeSets(guard.facts.workspace);
    } catch (e) {
      return buildEnvelope({
        tool: TOOL_NAME,
        workspace: guard.facts.workspace,
        gateId: input.gateId || null,
        status: 'ERROR',
        summary: 'Could not read git status for scope check.',
        errors: [makeError('GIT_COMMAND_FAILED', e.message, {}, true)],
        requiresHumanApproval: false,
      });
    }
  }

  const stagedFiles = [...new Set(changeSets.staged)];
  const unstagedFiles = [...new Set(changeSets.unstaged)];
  const untrackedFiles = [...new Set(changeSets.untracked)];
  const changedFiles = [...new Set([...stagedFiles, ...unstagedFiles, ...untrackedFiles])];

  const classifyInput = changedFiles.map((p) => ({ path: p, untracked: untrackedFiles.includes(p) }));
  const { allowedChanges, violations } = classifyPaths(guard.facts.workspace, classifyInput, rules);

  const scopeStatus = violations.length ? 'BLOCKED' : 'PASS';

  return buildEnvelope({
    tool: TOOL_NAME,
    workspace: guard.facts.workspace,
    gateId: input.gateId || null,
    status: scopeStatus,
    summary: violations.length
      ? `${violations.length} change(s) violate the allowed scope.`
      : 'All changed files are within the allowed scope.',
    data: {
      changedFiles,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
      allowedChanges,
      violations,
      violationCount: violations.length,
      scopeStatus,
    },
    errors: violations.length
      ? [makeError('SCOPE_VIOLATION', 'One or more changed files violate the allowed scope.', { violations }, true)]
      : [],
    requiresHumanApproval: violations.length > 0,
  });
}

module.exports = {
  name: TOOL_NAME,
  handle,
  classifyPaths,
  gatherChangeSets,
  HARD_FORBIDDEN_FILES,
  HARD_FORBIDDEN_DIRECTORIES,
  DEFAULT_ALLOWED_DIRECTORIES,
};
