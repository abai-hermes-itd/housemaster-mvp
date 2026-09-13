'use strict';

/**
 * Standard error model for Development MCP v0.1 (MCP-D02, section 5).
 * Exactly these codes are supported — no others.
 */
const ERROR_CODES = Object.freeze([
  'WORKSPACE_NOT_FOUND',
  'NOT_GIT_REPOSITORY',
  'WRONG_REPOSITORY',
  'WRONG_BRANCH',
  'DIRTY_BASELINE',
  'SCOPE_VIOLATION',
  'GIT_COMMAND_FAILED',
  'DIFF_CHECK_FAILED',
  'TEST_FAILED',
  'INVALID_TOOL_INPUT',
  'OUTSIDE_WORKSPACE_ACCESS',
]);

/**
 * @param {string} errorCode  one of ERROR_CODES
 * @param {string} message    human-readable explanation
 * @param {*} evidence         arbitrary evidence payload (facts, paths, raw output)
 * @param {boolean} recoverable whether a human could plausibly resolve this and retry
 */
function makeError(errorCode, message, evidence = null, recoverable = false) {
  if (!ERROR_CODES.includes(errorCode)) {
    throw new Error(`UNKNOWN_ERROR_CODE: "${errorCode}" is not a registered Development MCP error code.`);
  }
  return { errorCode, message, evidence, recoverable };
}

module.exports = { ERROR_CODES, makeError };
