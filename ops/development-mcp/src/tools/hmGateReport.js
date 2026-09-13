'use strict';

const { buildEnvelope } = require('../envelope');
const { makeError } = require('../errors');
const { checkWorkspace } = require('../workspaceGuard');
const { ALLOWED_SUBCOMMANDS } = require('../git');
const repoStatus = require('./hmRepoStatus');
const diffSummary = require('./hmDiffSummary');
const scopeCheck = require('./hmScopeCheck');

const TOOL_NAME = 'hm_gate_report';

const FORBIDDEN_GIT_SUBCOMMANDS = Object.freeze([
  'add',
  'commit',
  'push',
  'pull',
  'reset',
  'clean',
  'checkout',
  'switch',
  'merge',
  'rebase',
]);

const TECHNICAL_VERDICTS = Object.freeze(['PASS', 'BLOCKED', 'ERROR']);
const NEXT_ACTIONS = Object.freeze(['RETURN_TO_ARCHITECT_REVIEW', 'FIX_CURRENT_GATE', 'HUMAN_APPROVAL_REQUIRED']);
// Explicitly-forbidden outcomes this tool must never produce (defense in
// depth on top of the closed enums above).
const FORBIDDEN_OUTCOMES = Object.freeze(['APPROVED', 'START_NEXT_GATE']);

function assertLegalVerdict(v) {
  if (FORBIDDEN_OUTCOMES.includes(v) || !TECHNICAL_VERDICTS.includes(v)) {
    throw new Error(`ILLEGAL_TECHNICAL_VERDICT: "${v}" is not permitted.`);
  }
  return v;
}
function assertLegalNextAction(a) {
  if (FORBIDDEN_OUTCOMES.includes(a) || !NEXT_ACTIONS.includes(a)) {
    throw new Error(`ILLEGAL_NEXT_ACTION: "${a}" is not permitted.`);
  }
  return a;
}

/**
 * checkSecurityInvariant: verifies the running git allowlist contains none
 * of the destructive subcommands. Pure w.r.t. its input set — exported so
 * tests can pass a tampered set and prove the BLOCK path works without
 * ever touching the real allowlist.
 */
function checkSecurityInvariant(allowedSubcommands = ALLOWED_SUBCOMMANDS) {
  const leaked = FORBIDDEN_GIT_SUBCOMMANDS.filter((cmd) => allowedSubcommands.has(cmd));
  return { ok: leaked.length === 0, leaked };
}

/**
 * Precedence (MCP-D03 section 6, highest first):
 *   SECURITY BLOCK > WORKSPACE BLOCK > SCOPE BLOCK > TEST BLOCK > WARNING > PASS
 * Pure function — exported for direct precedence-ordering unit tests.
 */
function resolveVerdict({ securityOk, workspaceOk, scopeStatus, testStatus, hasWarnings }) {
  if (!securityOk) return { technicalVerdict: 'BLOCKED', reason: 'SECURITY', nextAction: 'RETURN_TO_ARCHITECT_REVIEW' };
  if (!workspaceOk) return { technicalVerdict: 'BLOCKED', reason: 'WORKSPACE', nextAction: 'RETURN_TO_ARCHITECT_REVIEW' };
  if (scopeStatus === 'BLOCKED') return { technicalVerdict: 'BLOCKED', reason: 'SCOPE', nextAction: 'FIX_CURRENT_GATE' };
  if (testStatus === 'FAIL') return { technicalVerdict: 'BLOCKED', reason: 'TEST', nextAction: 'FIX_CURRENT_GATE' };
  if (hasWarnings) return { technicalVerdict: 'PASS', reason: 'WARNING', nextAction: 'HUMAN_APPROVAL_REQUIRED' };
  return { technicalVerdict: 'PASS', reason: 'PASS', nextAction: 'HUMAN_APPROVAL_REQUIRED' };
}

/**
 * hm_gate_report: aggregates repo-status + scope-check + diff-summary (+
 * caller-supplied external test outcome) into one technical report for a
 * human reviewer.
 *
 * IMPORTANT: this tool NEVER decides CONSENSUS, NEVER starts a gate, and
 * NEVER returns "APPROVED" or "START_NEXT_GATE" (neither is a legal value
 * of technicalVerdict/nextAction — see assertLegalVerdict/assertLegalNextAction).
 * requiresHumanApproval is always true: gate/consensus decisions remain
 * strictly human-owned regardless of how clean the technical facts are.
 */
function handle(input = {}, ctx = {}) {
  const workspace = (ctx && ctx.workspace) || process.cwd();
  const guard = checkWorkspace(workspace);
  const security = checkSecurityInvariant();

  if (!input || typeof input.gateId !== 'string' || !input.gateId.trim()) {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace,
      status: 'ERROR',
      summary: 'Invalid input: "gateId" (non-empty string) is required.',
      data: { technicalVerdict: 'ERROR', nextAction: assertLegalNextAction('HUMAN_APPROVAL_REQUIRED') },
      errors: [makeError('INVALID_TOOL_INPUT', 'input.gateId must be a non-empty string.', { input }, true)],
      requiresHumanApproval: true,
    });
  }

  if (input.testStatus !== undefined && !['PASS', 'FAIL', 'SKIPPED'].includes(input.testStatus)) {
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace,
      gateId: input.gateId,
      status: 'ERROR',
      summary: 'Invalid input: "testStatus" must be one of PASS, FAIL, SKIPPED.',
      data: { technicalVerdict: 'ERROR', nextAction: assertLegalNextAction('HUMAN_APPROVAL_REQUIRED') },
      errors: [makeError('INVALID_TOOL_INPUT', 'input.testStatus must be PASS | FAIL | SKIPPED.', { input }, true)],
      requiresHumanApproval: true,
    });
  }

  if (!guard.ok) {
    const { technicalVerdict, nextAction } = resolveVerdict({
      securityOk: security.ok,
      workspaceOk: false,
      scopeStatus: 'UNKNOWN',
      testStatus: input.testStatus || 'SKIPPED',
      hasWarnings: false,
    });
    return buildEnvelope({
      tool: TOOL_NAME,
      workspace,
      gateId: input.gateId,
      status: assertLegalVerdict(technicalVerdict),
      summary: `Workspace guard failed: ${guard.error.errorCode}`,
      data: { technicalVerdict, nextAction: assertLegalNextAction(nextAction), securityOk: security.ok, workspaceOk: false },
      errors: [guard.error],
      requiresHumanApproval: true,
    });
  }

  const statusReport = repoStatus.handle({}, { workspace: guard.facts.workspace });
  const scopeInput = input.scope && typeof input.scope === 'object' ? { ...input.scope, gateId: input.gateId } : { gateId: input.gateId };
  const scopeReport = scopeCheck.handle(scopeInput, { workspace: guard.facts.workspace });
  const diffReport = diffSummary.handle({ baselineRef: input.baselineRef }, { workspace: guard.facts.workspace });
  const testStatus = input.testStatus || 'SKIPPED';

  const warnings = [...statusReport.warnings, ...scopeReport.warnings, ...diffReport.warnings];
  const errors = [...statusReport.errors, ...scopeReport.errors, ...diffReport.errors];

  const { technicalVerdict, reason, nextAction } = resolveVerdict({
    securityOk: security.ok,
    workspaceOk: true,
    scopeStatus: scopeReport.status,
    testStatus,
    hasWarnings: warnings.length > 0,
  });

  assertLegalVerdict(technicalVerdict);
  assertLegalNextAction(nextAction);

  return buildEnvelope({
    tool: TOOL_NAME,
    workspace: guard.facts.workspace,
    gateId: input.gateId,
    status: technicalVerdict,
    summary:
      `Technical gate report only (blocking reason: ${reason}). This tool reports facts; it does not decide ` +
      'CONSENSUS and never returns APPROVED or START_NEXT_GATE — a human makes the gate decision.',
    data: {
      technicalVerdict,
      nextAction,
      blockingReason: reason,
      securityOk: security.ok,
      workspaceOk: true,
      testStatus,
      repoStatus: statusReport,
      scopeCheck: scopeReport,
      diffSummary: diffReport,
    },
    warnings,
    errors,
    requiresHumanApproval: true,
  });
}

module.exports = { name: TOOL_NAME, handle, resolveVerdict, checkSecurityInvariant, TECHNICAL_VERDICTS, NEXT_ACTIONS, FORBIDDEN_OUTCOMES };
