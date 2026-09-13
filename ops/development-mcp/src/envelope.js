'use strict';

/**
 * Common result envelope for Development MCP v0.1 (MCP-D02, section 4).
 * Every tool response — success, block, or error — is wrapped in this
 * exact shape. The envelope may NEVER carry an "APPROVED" status: this
 * server reports technical facts only and never decides consensus/gates.
 */

const ENVELOPE_VERSION = '0.1.0';
const ALLOWED_STATUS = Object.freeze(['PASS', 'BLOCKED', 'ERROR']);

function buildEnvelope({
  tool,
  workspace,
  gateId = null,
  status,
  summary,
  data = {},
  warnings = [],
  errors = [],
  requiresHumanApproval = false,
}) {
  if (!ALLOWED_STATUS.includes(status)) {
    throw new Error(
      `INVALID_ENVELOPE_STATUS: "${status}" is not one of ${ALLOWED_STATUS.join(', ')}. ` +
        'Development MCP must never emit APPROVED or any other status.'
    );
  }
  if (!tool || typeof tool !== 'string') {
    throw new Error('INVALID_ENVELOPE: "tool" is required and must be a string.');
  }

  return {
    tool,
    version: ENVELOPE_VERSION,
    timestamp: new Date().toISOString(),
    workspace: workspace || null,
    gateId: gateId || null,
    status,
    summary: summary || '',
    data: data || {},
    warnings: Array.isArray(warnings) ? warnings : [],
    errors: Array.isArray(errors) ? errors : [],
    requiresHumanApproval: !!requiresHumanApproval,
  };
}

module.exports = { buildEnvelope, ALLOWED_STATUS, ENVELOPE_VERSION };
