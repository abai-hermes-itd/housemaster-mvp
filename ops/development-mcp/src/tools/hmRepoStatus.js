'use strict';

const { buildEnvelope } = require('../envelope');
const { checkWorkspace } = require('../workspaceGuard');
const { runGit } = require('../git');

const TOOL_NAME = 'hm_repo_status';

/**
 * Parses `git status --porcelain --untracked-files=all` output into counts.
 * Pure function — exported for isolated unit testing (MCP-D03 section 3).
 */
function summarizePorcelain(porcelainOutput) {
  const lines = porcelainOutput ? porcelainOutput.split('\n').filter(Boolean) : [];
  let trackedChangeCount = 0;
  let untrackedCount = 0;
  let stagedCount = 0;

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const isUntracked = x === '?' && y === '?';
    if (isUntracked) {
      untrackedCount += 1;
    } else {
      trackedChangeCount += 1;
      if (x !== ' ' && x !== '?') stagedCount += 1;
    }
  }

  return { trackedChangeCount, untrackedCount, stagedCount };
}

/**
 * Parses `git rev-list --left-right --count A...B` output ("<ahead>\t<behind>").
 * Pure function — exported for isolated unit testing.
 */
function parseAheadBehind(revListOutput) {
  const parts = String(revListOutput || '').trim().split(/\s+/);
  const ahead = Number.parseInt(parts[0], 10);
  const behind = Number.parseInt(parts[1], 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

/**
 * hm_repo_status: reports canonical-workspace / branch / HEAD / remote /
 * ahead-behind / clean-state facts. Read-only. Never repairs a mismatch —
 * only reports it.
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

  const { facts } = guard;
  const warnings = [];
  if (!facts.clean) {
    warnings.push('Working tree is not clean.');
  }

  // Enrichment beyond the base guard facts (guard itself is left untouched
  // for regression safety — see MCP-D03 section 9).
  let remotePush = facts.remoteUrl;
  try {
    remotePush = runGit(['remote', 'get-url', '--push', 'origin'], facts.workspace);
  } catch (e) {
    warnings.push(`Could not resolve push URL separately from fetch URL: ${e.message}`);
  }

  let ahead = null;
  let behind = null;
  try {
    const counts = runGit(['rev-list', '--left-right', '--count', `${facts.branch}...origin/${facts.branch}`], facts.workspace);
    ({ ahead, behind } = parseAheadBehind(counts));
  } catch (e) {
    warnings.push(`Could not compute ahead/behind vs origin/${facts.branch}: ${e.message}`);
  }

  let trackedChangeCount = 0;
  let untrackedCount = 0;
  let stagedCount = 0;
  try {
    const fullPorcelain = runGit(['status', '--porcelain', '--untracked-files=all'], facts.workspace);
    ({ trackedChangeCount, untrackedCount, stagedCount } = summarizePorcelain(fullPorcelain));
  } catch (e) {
    warnings.push(`Could not compute detailed change counts: ${e.message}`);
  }

  const detachedHead = facts.branch === 'HEAD';

  return buildEnvelope({
    tool: TOOL_NAME,
    workspace: facts.workspace,
    status: 'PASS',
    summary: 'Canonical repository, branch, and remote verified.',
    data: {
      // MCP-D03 contract fields
      repoRoot: facts.workspace,
      branch: facts.branch,
      headSha: facts.headSha,
      remoteFetch: facts.remoteUrl,
      remotePush,
      ahead,
      behind,
      workingTreeClean: facts.clean,
      trackedChangeCount,
      untrackedCount,
      stagedCount,
      detachedHead,
      status: facts.clean ? 'CLEAN' : 'DIRTY',
      // Kept for backward compatibility with MCP-D02 callers (additive, non-breaking)
      remoteUrl: facts.remoteUrl,
      repoSlug: facts.repoSlug,
      clean: facts.clean,
      dirtyEntries: facts.dirtyEntries,
    },
    warnings,
    requiresHumanApproval: false,
  });
}

module.exports = { name: TOOL_NAME, handle, summarizePorcelain, parseAheadBehind };
