import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, ROOT, sandbox } from './helpers.mjs';
import { generatedFiles } from '../lib/claude-plugin.mjs';

test('workbench adapter preserves Python arguments, cwd, output and status', () => {
  const box = sandbox();
  const python = process.env.X100_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  for (const [name, file] of [['mapper', 'project-mapper/scripts/project_mapper.py'], ['scope', 'new-scope/contract.py']]) {
    const script = path.join(ROOT, 'skills', file);
    const direct = spawnSync(python, ['-B', script, '--help'], { cwd: box.project, encoding: 'utf8' });
    const through = cli(['workbench', name, '--help'], { cwd: box.project, env: { ...box.env, X100_PYTHON: python } });
    assert.equal(through.code, direct.status, through.err);
    assert.equal(through.out, direct.stdout);
    assert.equal(through.err, direct.stderr);
  }
  const missing = cli(['workbench', 'mapper', '.', '--offline', 'coverage', '--summary'], { cwd: box.project, env: { ...box.env, X100_PYTHON: python } });
  assert.notEqual(missing.code, 0);
  assert.ok(missing.err.trim(), 'the underlying diagnostic is visible');
  assert.equal(fs.existsSync(path.join(box.project, '.project-mapper')), false, 'offline lookup is read-only');
  box.cleanup();
});

test('plugin uses the installed Python runtime instead of asking agents to reconstruct modules', () => {
  const files = generatedFiles(ROOT);
  for (const [name, tool] of [['project-mapper', 'mapper'], ['new-scope', 'scope'], ['execute-scope', 'execute'], ['qa-scope', 'qa']]) {
    const prefix = `skills/${name}/`;
    const skill = files.get(`${prefix}SKILL.md`).toString('utf8');
    assert.match(skill, new RegExp(`100x workbench ${tool}`));
    assert.ok(![...files.keys()].some((item) => item.startsWith(prefix) && /\.py(?:\.md)?$/.test(item)));
    assert.doesNotMatch(skill, /\{\{[A-Z_]*POLICY\}\}/);
  }
  assert.match(files.get('skills/execute-scope/PLANNED.md').toString(), /Run `100x workbench execute`/);
  assert.match(files.get('skills/qa-scope/SKILL.md').toString(), /Run `100x workbench qa`/);
  assert.match(files.get('skills/project-mapper/references/workflow.md').toString(), /path from 100x workbench path mapper/);
});
