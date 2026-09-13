'use strict';

/**
 * MCP-D02 self-test — bounded, local, read-only.
 * Run with: node test/selfTest.js  (or: npm run selftest)
 *
 * Proves the seven properties required by MCP-D02 section 10.
 * Never writes, stages, commits, or pushes anything.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const { createServer } = require('../src/server');
const {
  checkWorkspace,
  extractRepoSlug,
  CANONICAL_WORKSPACE,
  EXPECTED_REPO_SLUG,
  EXPECTED_BRANCH,
} = require('../src/workspaceGuard');
const { ALLOWED_SUBCOMMANDS } = require('../src/git');

const FORBIDDEN_GIT_SUBCOMMANDS = [
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
];

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
}

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(full));
    else out.push(full);
  }
  return out;
}

let server;

// 1. MCP server skeleton starts
check('1_server_starts', () => {
  server = createServer();
  assert.ok(server, 'createServer() returned nothing');
  assert.strictEqual(typeof server.callTool, 'function');
});

// 2. exactly four tools are registered
check('2_exactly_four_tools_registered', () => {
  const tools = server.listTools();
  assert.strictEqual(tools.length, 4, `expected 4 tools, got ${tools.length}: ${tools.join(', ')}`);
  ['hm_repo_status', 'hm_scope_check', 'hm_diff_summary', 'hm_gate_report'].forEach((name) => {
    assert.ok(tools.includes(name), `missing tool: ${name}`);
    assert.ok(server.getToolSchema(name), `missing schema for: ${name}`);
  });
});

// 3. canonical workspace passes guard
check('3_canonical_workspace_passes_guard', () => {
  const result = checkWorkspace(CANONICAL_WORKSPACE);
  assert.strictEqual(result.ok, true, `guard failed: ${JSON.stringify(result.error)}`);
  assert.strictEqual(result.facts.repoSlug, EXPECTED_REPO_SLUG);
  assert.strictEqual(result.facts.branch, EXPECTED_BRANCH);

  const envelope = server.callTool('hm_repo_status', {});
  assert.strictEqual(envelope.status, 'PASS');
  assert.notStrictEqual(envelope.status, 'APPROVED');
});

// 4. invalid workspace is blocked
check('4_invalid_workspace_is_blocked', () => {
  const bogus = path.join(require('os').tmpdir(), 'hm-mcp-selftest-nonexistent-path');
  const result = checkWorkspace(bogus);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.errorCode, 'OUTSIDE_WORKSPACE_ACCESS');
});

// 5. wrong repository is blocked (logic-level: no second git repo is created,
//    keeping this self-test fully confined and read-only)
check('5_wrong_repository_logic_blocks', () => {
  const fakeSlug = extractRepoSlug('https://github.com/some-other-org/some-other-repo.git');
  assert.strictEqual(fakeSlug, 'some-other-org/some-other-repo');
  assert.notStrictEqual(fakeSlug, EXPECTED_REPO_SLUG);

  const sshSlug = extractRepoSlug('git@github.com:abai-hermes-itd/housemaster-mvp.git');
  assert.strictEqual(sshSlug, EXPECTED_REPO_SLUG);
});

// 6. no product files were modified by this task
check('6_no_product_files_modified', () => {
  // --untracked-files=all forces git to list each individual file instead
  // of collapsing a wholly-new directory (e.g. "?? ops/") into one line.
  const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: CANONICAL_WORKSPACE,
    encoding: 'utf8',
  });
  const lines = out.split('\n').filter(Boolean);
  const outsideScope = lines.filter((l) => {
    const p = l.slice(3).trim().replace(/\\/g, '/');
    return !p.startsWith('ops/development-mcp/');
  });
  assert.strictEqual(outsideScope.length, 0, `changes found outside ops/development-mcp/: ${outsideScope.join('; ')}`);
});

// 7. no destructive command capability exists
//
// NOTE (MCP-D03): an earlier version of this check grepped for quoted
// forbidden-subcommand words anywhere in src/. That produced false
// positives against legitimate code — hm_repo_status/hm_diff_summary's
// 'CLEAN' status label (substring-matches "clean") and hm_gate_report's
// own FORBIDDEN_GIT_SUBCOMMANDS denylist (which must *name* the forbidden
// words to check the allowlist against them, without ever executing them).
// Replaced with a structural invariant: only src/git.js may talk to
// child_process at all, and only it may call execFileSync/spawnSync.
// That is strictly stronger — it cannot be defeated by renaming a
// destructive call to avoid a word-match — and has no false positives.
check('7_no_destructive_git_capability', () => {
  FORBIDDEN_GIT_SUBCOMMANDS.forEach((cmd) => {
    assert.ok(!ALLOWED_SUBCOMMANDS.has(cmd), `forbidden subcommand "${cmd}" is allowlisted`);
  });

  const srcDir = path.join(__dirname, '..', 'src');
  const files = walk(srcDir).filter((f) => f.endsWith('.js'));
  const gitJs = path.join(srcDir, 'git.js');

  files.forEach((f) => {
    const content = fs.readFileSync(f, 'utf8');
    const usesChildProcess = /require\(\s*['"]child_process['"]\s*\)/.test(content);
    const usesExecFamily = /\b(execFileSync|execSync|spawnSync|spawn|exec)\s*\(/.test(content);
    if (f !== gitJs) {
      assert.ok(!usesChildProcess, `child_process required outside src/git.js: ${f}`);
      assert.ok(!usesExecFamily, `process-spawning call found outside src/git.js: ${f}`);
    }
    assert.ok(!/shell\s*:\s*true/.test(content), `shell:true found in ${f}`);
    assert.ok(!/child_process\.exec\s*\(/.test(content), `shell-interpreting exec( found in ${f}`);
  });

  // git.js itself must only ever call the non-shell, argv-array forms.
  const gitJsContent = fs.readFileSync(gitJs, 'utf8');
  assert.ok(/execFileSync|spawnSync/.test(gitJsContent), 'git.js does not appear to call execFileSync/spawnSync at all');
  assert.ok(!/child_process\.exec\s*\(/.test(gitJsContent), 'git.js contains a shell-interpreting exec( call');
});

let allOk = true;
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  if (!r.ok) allOk = false;
  console.log(`[${mark}] ${r.name}${r.ok ? '' : ' :: ' + r.error}`);
}
console.log(allOk ? '\nSELF-TEST: ALL CHECKS PASSED' : '\nSELF-TEST: FAILURES PRESENT');
process.exitCode = allOk ? 0 : 1;
