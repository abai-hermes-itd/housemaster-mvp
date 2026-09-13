'use strict';

/**
 * Minimal in-process tool registry (MCP-D02, section 7).
 * Exactly four tools are ever registered by src/server.js:
 *   hm_repo_status, hm_scope_check, hm_diff_summary, hm_gate_report
 * This class does not enforce that list itself (that would duplicate the
 * server's registration call) — it just refuses duplicate names and
 * exposes list/get/call.
 */
class ToolRegistry {
  constructor() {
    this._tools = new Map();
  }

  register(name, schema, handler) {
    if (!name || typeof name !== 'string') {
      throw new Error('Tool name must be a non-empty string.');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Tool "${name}" requires a handler function.`);
    }
    if (this._tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }
    this._tools.set(name, { name, schema, handler });
  }

  get(name) {
    return this._tools.get(name);
  }

  list() {
    return Array.from(this._tools.keys());
  }

  call(name, input, ctx) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered.`);
    }
    return tool.handler(input, ctx);
  }
}

module.exports = { ToolRegistry };
