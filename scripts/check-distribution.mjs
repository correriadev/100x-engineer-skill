#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/paths.mjs';

const packed = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
  cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32',
});
if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr || packed.error?.message}`);
const files = new Set(JSON.parse(packed.stdout)[0].files.map((item) => item.path));
const required = [
  'skills/project-mapper/scripts/project_mapper.py', 'skills/project-mapper/scripts/graph_store.py',
  'skills/project-mapper/scripts/requirements-csharp.txt', 'skills/project-mapper/tests/test_refresh.py',
  'skills/new-scope/contract.py', 'skills/new-scope/schema.sql', 'skills/new-scope/tests/test_execute_handoff.py',
  'skills/execute-scope/contract.py', 'skills/execute-scope/PLANNED.md', 'skills/execute-scope/tests/test_preflight.py',
  'skills/qa-scope/contract.py', 'skills/qa-scope/portable_evidence.py',
  'skills/qa-scope/tests/test_candidate_evidence.py', 'skills/qa-scope/tests/test_portable_identity.py',
  'lib/commands/workbench.mjs',
];
const missing = required.filter((file) => !files.has(file));
if (missing.length) throw new Error(`Distribution is missing: ${missing.join(', ')}`);
for (const skill of ['project-mapper', 'new-scope', 'execute-scope', 'qa-scope']) {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
  if (/\{\{[A-Z_]*POLICY\}\}/.test(text)) throw new Error(`${skill} has an unresolved provider policy`);
}
console.log(`distribution contains ${required.length} required runtime, schema and test files`);
