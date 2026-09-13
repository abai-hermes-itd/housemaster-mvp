'use strict';

const { buildEnvelope } = require('../envelope');
const { makeError } = require('../errors');
const { checkWorkspace } = require('../workspaceGuard');
const { runGit, runGitSafe } = require('../git');

const TOOL_NAME = 'hm_diff_summary';

const RISK_FLAGS = Object.freeze([
  'LARGE_DIFF',
  'BINARY_CHANGE',
  'DELETION',
  'CONFIG_CHANGE',
  'DEPENDENCY_CHANGE',
  'GENERATED_FILE_CHANGE',
  'FORBIDDEN_PATH_TOUCH',
  'UNEXPECTED_RENAME',
]);

const LARGE_DIFF_FILE_THRESHOLD = 20;
const LARGE_DIFF_LINE_THRESHOLD = 500;

const CONFIG_PATTERN = /\.(json|ya?ml|env|toml|ini)$|(^|\/)config(\.|\/)/i;
const DEPENDENCY_FILES = ['package.json', 'package-lock.json', 'yarn.lock', 'requirements.txt', 'Gemfile.lock'];
const GENERATED_PATTERN = /(^|\/)(dist|build|node_modules)\/|\.min\.(js|css)$/i;
const FORBIDDEN_PATHS = ['index.html']; // mirrors hm_scope_check's HARD_FORBIDDEN_FILES

/**
 * Parses `git diff --name-status <ref>` output.
 * Pure function — exported for MCP-D03 D3 synthetic unit tests.
 */
function parseNameStatus(raw) {
  const addedFiles = [];
  const modifiedFiles = [];
  const deletedFiles = [];
  const renameFiles = [];

  for (const line of String(raw || '').split('\n').filter(Boolean)) {
    const cols = line.split('\t');
    const code = cols[0];

    if (code.startsWith('R') || code.startsWith('C')) {
      renameFiles.push({ from: cols[1], to: cols[2], similarity: code.slice(1) || null, type: code[0] === 'R' ? 'renamed' : 'copied' });
    } else if (code === 'A') {
      addedFiles.push(cols[1]);
    } else if (code === 'D') {
      deletedFiles.push(cols[1]);
    } else if (code === 'M') {
      modifiedFiles.push(cols[1]);
    }
    // Other codes (T = type-change, U = unmerged) are intentionally not
    // classified further in this v0.1 skeleton.
  }

  return { addedFiles, modifiedFiles, deletedFiles, renameFiles };
}

/**
 * Parses `git diff --numstat <ref>` output into per-file line counts and
 * detects binary files (numstat prints "-\t-\tpath" for binaries).
 * Pure function — exported for unit testing.
 */
function parseNumstat(raw) {
  const summaryByFile = [];
  const binaryFiles = [];

  for (const line of String(raw || '').split('\n').filter(Boolean)) {
    const [insStr, delStr, filePath] = line.split('\t');
    if (insStr === '-' && delStr === '-') {
      binaryFiles.push(filePath);
      summaryByFile.push({ path: filePath, insertions: 0, deletions: 0, binary: true });
    } else {
      summaryByFile.push({
        path: filePath,
        insertions: Number.parseInt(insStr, 10) || 0,
        deletions: Number.parseInt(delStr, 10) || 0,
        binary: false,
      });
    }
  }

  return { summaryByFile, binaryFiles };
}

/**
 * Parses `git diff --shortstat <ref>` output
 * ("N files changed, X insertions(+), Y deletions(-)").
 * Pure function — exported for unit testing.
 */
function parseShortstat(raw) {
  const text = String(raw || '');
  const insMatch = text.match(/(\d+) insertion/);
  const delMatch = text.match(/(\d+) deletion/);
  return {
    insertions: insMatch ? Number.parseInt(insMatch[1], 10) : 0,
    deletions: delMatch ? Number.parseInt(delMatch[1], 10) : 0,
  };
}

/**
 * Computes risk flags from already-classified diff facts. Pure function.
 */
function computeRiskFlags({ changedFiles, binaryFiles, deletedFiles, renameFiles, insertions, deletions }) {
  const flags = [];
  if (changedFiles.length > LARGE_DIFF_FILE_THRESHOLD || insertions + deletions > LARGE_DIFF_LINE_THRESHOLD) {
    flags.push('LARGE_DIFF');
  }
  if (binaryFiles.length > 0) flags.push('BINARY_CHANGE');
  if (deletedFiles.length > 0) flags.push('DELETION');
  if (changedFiles.some((p) => CONFIG_PATTERN.test(p))) flags.push('CONFIG_CHANGE');
  if (changedFiles.some((p) => DEPENDENCY_FILES.includes(p.split('/').pop()))) flags.push('DEPENDENCY_CHANGE');
  if (changedFiles.some((p) => GENERATED_PATTERN.test(p))) flags.push('GENERATED_FILE_CHANGE');
  if (changedFiles.some((p) => FORBIDDEN_PATHS.includes(p))) flags.push('FORBIDDEN_PATH_TOUCH');
  if (renameFiles.length > 0) flags.push('UNEXPECTED_RENAME');
  return flags;
}

/**
 * hm_diff_summary: read-only `git diff` facts relative to baselineRef
 * (default HEAD, i.e. working-tree changes vs the last commit). Never
 * stages or commits anything — every git call goes through the
 * allowlisted runner in src/git.js.
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

  if (input && input.baseRef !== undefined && typeof input.baseRef !== 'string') {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status: 'ERROR',
      summary: 'Invalid input: "baseRef" must be a string when provided.',
      errors: [makeError('INVALID_TOOL_INPUT', 'input.baseRef must be a string.', { input }, true)],
      requiresHumanApproval: false,
    });
  }
  if (input && input.baselineRef !== undefined && typeof input.baselineRef !== 'string') {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status: 'ERROR',
      summary: 'Invalid input: "baselineRef" must be a string when provided.',
      errors: [makeError('INVALID_TOOL_INPUT', 'input.baselineRef must be a string.', { input }, true)],
      requiresHumanApproval: false,
    });
  }

  // baselineRef is the MCP-D03 contract name; baseRef is kept as an alias
  // for MCP-D02 backward compatibility.
  const baselineRef = (input && (input.baselineRef || input.baseRef)) || 'HEAD';

  // Validate the ref exists before doing anything else with it (D6).
  try {
    runGit(['rev-parse', '--verify', '--quiet', baselineRef], guard.facts.workspace);
  } catch (e) {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status: 'ERROR',
      summary: `baselineRef "${baselineRef}" could not be resolved.`,
      errors: [makeError('DIFF_CHECK_FAILED', `Unknown or invalid ref: ${baselineRef}`, { baselineRef, message: e.message }, true)],
      requiresHumanApproval: false,
    });
  }

  let currentHead;
  try {
    currentHead = runGit(['rev-parse', 'HEAD'], guard.facts.workspace);
  } catch (e) {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status: 'ERROR',
      summary: 'Could not resolve current HEAD.',
      errors: [makeError('GIT_COMMAND_FAILED', e.message, {}, true)],
      requiresHumanApproval: false,
    });
  }

  try {
    const nameStatusRaw = runGit(['diff', '--name-status', baselineRef], guard.facts.workspace);
    const numstatRaw = runGit(['diff', '--numstat', baselineRef], guard.facts.workspace);
    const shortstatRaw = runGit(['diff', '--shortstat', baselineRef], guard.facts.workspace);

    const { addedFiles, modifiedFiles, deletedFiles, renameFiles } = parseNameStatus(nameStatusRaw);
    const { summaryByFile, binaryFiles } = parseNumstat(numstatRaw);
    const { insertions, deletions } = parseShortstat(shortstatRaw);

    const changedFiles = [
      ...addedFiles,
      ...modifiedFiles,
      ...deletedFiles,
      ...renameFiles.map((r) => r.to),
    ];

    // `git diff --check` legitimately exits non-zero when it finds issues —
    // handled via the non-throwing runner, never treated as a crash.
    const checkResult = runGitSafe(['diff', '--check', baselineRef], guard.facts.workspace);
    const diffCheckStatus = checkResult.status === 0 ? 'CLEAN' : 'ISSUES_FOUND';

    const riskFlags = computeRiskFlags({ changedFiles, binaryFiles, deletedFiles, renameFiles, insertions, deletions });

    const warnings = [];
    if (diffCheckStatus === 'ISSUES_FOUND') {
      warnings.push('git diff --check reported whitespace or conflict-marker issues.');
    }

    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status: 'PASS',
      summary: `${changedFiles.length} file(s) differ from ${baselineRef}.`,
      data: {
        baselineRef,
        currentHead,
        changedFiles,
        addedFiles,
        modifiedFiles,
        deletedFiles,
        renameFiles,
        insertions,
        deletions,
        binaryFiles,
        diffCheckStatus,
        diffCheckDetail: checkResult.stdout || null,
        summaryByFile,
        riskFlags,
        // Backward compatibility with MCP-D02 callers (additive, non-breaking)
        baseRef: baselineRef,
        changed: [...addedFiles.map((p) => ({ code: 'A', path: p })), ...modifiedFiles.map((p) => ({ code: 'M', path: p })), ...deletedFiles.map((p) => ({ code: 'D', path: p }))],
        stat: shortstatRaw,
      },
      warnings,
      requiresHumanApproval: false,
    });
  } catch (e) {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace: guard.facts.workspace,
      status: 'ERROR',
      summary: 'git diff failed.',
      errors: [makeError('DIFF_CHECK_FAILED', e.message, { baselineRef }, true)],
      requiresHumanApproval: false,
    });
  }
}

module.exports = {
  name: TOOL_NAME,
  handle,
  parseNameStatus,
  parseNumstat,
  parseShortstat,
  computeRiskFlags,
  RISK_FLAGS,
};
