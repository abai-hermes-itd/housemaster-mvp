'use strict';

/**
 * Development MCP v0.1 — read-only server skeleton (MCP-D02)
 *
 * Scope: technical execution helpers only — workspace/repo/scope/diff
 * facts for gate reviewers. This is NOT the HouseMaster Product MCP and
 * defines no product entities, measurement logic, geometry, cadastre/map
 * model, UX flow, report architecture, or Voice Guide architecture.
 *
 * Security boundary: this file and everything it requires contains no
 * code path capable of git add/commit/push/pull/reset/clean/checkout/
 * switch/merge/rebase, no deployment, no Plesk/DNS/GitHub-settings access,
 * no credential/secret access, and no shell wrapper that accepts
 * arbitrary commands. See src/git.js for the read-only git subcommand
 * allowlist that every git call in this server is forced through.
 *
 * Transport: this skeleton exposes an in-process registry only
 * (listTools / getToolSchema / callTool). Wiring a stdio/JSON-RPC MCP
 * transport is out of scope for MCP-D02 and is deferred to a future,
 * separately-approved gate — it is NOT started here.
 */

const { ToolRegistry } = require('./toolRegistry');
const { CANONICAL_WORKSPACE } = require('./workspaceGuard');

const repoStatusSchema = require('../schemas/hm_repo_status.schema.json');
const scopeCheckSchema = require('../schemas/hm_scope_check.schema.json');
const diffSummarySchema = require('../schemas/hm_diff_summary.schema.json');
const gateReportSchema = require('../schemas/hm_gate_report.schema.json');

const hmRepoStatus = require('./tools/hmRepoStatus');
const hmScopeCheck = require('./tools/hmScopeCheck');
const hmDiffSummary = require('./tools/hmDiffSummary');
const hmGateReport = require('./tools/hmGateReport');

function createServer(workspace = CANONICAL_WORKSPACE) {
  const registry = new ToolRegistry();

  // Exactly these four tools. Do not add more without a new gate.
  registry.register(hmRepoStatus.name, repoStatusSchema, hmRepoStatus.handle);
  registry.register(hmScopeCheck.name, scopeCheckSchema, hmScopeCheck.handle);
  registry.register(hmDiffSummary.name, diffSummarySchema, hmDiffSummary.handle);
  registry.register(hmGateReport.name, gateReportSchema, hmGateReport.handle);

  return {
    workspace,
    listTools: () => registry.list(),
    getToolSchema: (name) => {
      const tool = registry.get(name);
      return tool ? tool.schema : undefined;
    },
    callTool: (name, input) => registry.call(name, input, { workspace }),
  };
}

if (require.main === module) {
  const server = createServer();
  console.log('Development MCP v0.1 (skeleton) — registered tools:', server.listTools());
  console.log('No network listener started. No stdio/JSON-RPC transport wired (deferred, not started).');
}

module.exports = { createServer };
