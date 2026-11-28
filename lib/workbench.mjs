import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.mjs';

export const WORKBENCH_PROGRAMS = {
  mapper: 'project-mapper/scripts/project_mapper.py',
  scope: 'new-scope/contract.py',
  execute: 'execute-scope/contract.py',
  qa: 'qa-scope/contract.py',
};

// X100_PYTHON is an executable path, never a shell fragment. An explicit choice
// is not silently replaced. The Windows launcher is used only when not configured.
export function pythonRuntime(env = process.env) {
  const choices = env.X100_PYTHON ? [[env.X100_PYTHON, []]] : process.platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  for (const [program, prefix] of choices) {
    const probe = spawnSync(program, [...prefix, '-c', 'import json,sqlite3,sys; print(json.dumps([list(sys.version_info[:3]),list(sqlite3.sqlite_version_info)]))'], { encoding: 'utf8', env });
    if (probe.error?.code === 'ENOENT') continue;
    try {
      const [python, sqlite] = JSON.parse(probe.stdout);
      if (probe.status === 0 && (python[0] > 3 || python[0] === 3 && python[1] >= 12) && (sqlite[0] > 3 || sqlite[0] === 3 && sqlite[1] >= 37)) return { program, prefix, python, sqlite };
    } catch { /* Try another available executable only when none was explicitly selected. */ }
    if (env.X100_PYTHON) break;
  }
  return null;
}

export function workbenchScript(name, root = REPO_ROOT) {
  return WORKBENCH_PROGRAMS[name] && path.join(root, 'skills', WORKBENCH_PROGRAMS[name]);
}

export function workbenchAvailable(name, root = REPO_ROOT) {
  const script = workbenchScript(name, root);
  return Boolean(script && fs.existsSync(script));
}

export function engineeringAssessment(root, changeId, environments = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId ?? '')) return { error: 'A planned run needs a kebab-case changeId.' };
  const runtime = pythonRuntime();
  if (!runtime) return { error: 'Python 3.12+ with SQLite 3.37+ is required; install it or set X100_PYTHON.' };
  const script = workbenchScript('qa');
  if (!fs.existsSync(script)) return { error: 'The bundled QA contract tool is missing.' };
  const folder = path.join(root, 'docs', 'specs', changeId);
  const result = spawnSync(runtime.program, [...runtime.prefix, '-B', script, folder, 'summary', '--project-root', root, '--environment-json', JSON.stringify(environments)], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) return { error: (result.stderr || result.error?.message || 'QA summary failed').trim() };
  try { return { summary: JSON.parse(result.stdout) }; } catch { return { error: 'QA summary returned invalid JSON.' }; }
}

// A finished assessment is a historical snapshot. Recompute current identity
// before presenting it as current; external environments remain caller-confirmed.
export function currentEngineeringState(root, run) {
  if (run?.mode !== 'engineering' || run.engineering?.type !== 'planned' || !run.finishedAt || !run.acceptance) return null;
  const found = engineeringAssessment(root, run.engineering.changeId, run.engineering.environments ?? {});
  const current = found.summary ?? { status: 'INCONCLUSIVE', reason: found.error };
  return current.status !== run.acceptance.status || current.candidate !== run.acceptance.candidate
    ? { status: current.status, reason: current.reason ?? 'The current candidate or evidence differs from the finished assessment.' }
    : null;
}
