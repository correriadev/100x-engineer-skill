import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BIN, cli, sandbox, write } from './helpers.mjs';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const canonical = (value) => JSON.stringify(value, function (key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  return item;
});

function tool(box, args, payload) {
  const result = spawnSync(process.execPath, [BIN, 'workbench', ...args], {
    cwd: box.project, env: { ...process.env, ...box.env }, encoding: 'utf8',
    ...(payload === undefined ? {} : { input: JSON.stringify(payload) }),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

function set(box, key, value) {
  const result = cli(['run', 'set', key, typeof value === 'string' ? value : JSON.stringify(value)], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
}

function start(box, settings) {
  assert.equal(cli(['init', '--no-git'], { cwd: box.project, env: box.env }).code, 0);
  set(box, 'mode', 'engineering');
  set(box, 'title', 'Cancellation fix');
  set(box, 'pitch', 'Prevent dispatch after cancellation.');
  set(box, 'verdict', 'ship');
  set(box, 'verdictWhy', 'The requested behavior was checked.');
  set(box, 'review', { status: 'unreviewed', note: 'No reviewer was used in this deterministic fixture.' });
  set(box, 'engineering', settings);
}

function fixture(box, outcome) {
  start(box, { type: 'planned', changeId: 'cancel-fix', visual: false, visualReason: 'No user interface is involved.', environments: { 'T1/check': 'Isolated fixture.' } });
  write(path.join(box.project, 'app.py'), 'def send(): return False\n');
  const folder = path.join(box.project, 'docs', 'specs', 'cancel-fix');
  const scope = '# Cancellation\n\nA1 Prevent dispatch.\nR1 Unexpected dispatch.\n';
  write(path.join(folder, 'SCOPE.md'), scope);
  const revision = sha(scope);
  const obligation = { id: 'QA-1', status: 'ready', pending_reason: null, blocking: true, acceptance_ids: ['A1'], risk_ids: ['R1'], failure_to_detect: 'Unexpected dispatch.', preconditions: ['Cancel first.'], stimulus: 'Request dispatch.', observables: ['Dispatch count.'], assertions: ['Expect zero.'], environment: 'Isolated fixture.', artifacts: ['Result JSON.'], source_refs: ['app.py:1'] };
  const contract = { change_id: 'cancel-fix', scope_revision: revision, risk_coverage: [{ risk_id: 'R1', obligation_ids: ['QA-1'] }], obligations: [obligation] };
  tool(box, ['qa', folder, 'qa-plan', '--expect', 'absent'], contract);
  const qaRevision = tool(box, ['qa', folder, 'inspect']).qa_revision;
  const check = { id: 'check', command: 'python app.py', qa_ids: ['QA-1'], files: ['app.py'] };
  const task = { id: 'T1', project_path: box.project, kind: 'evidence', files_allowed: [], evidence_checks: [check], depends_on: [], status: 'pending', phase: 'evidence_pending' };
  const plan = { change_id: 'cancel-fix', scope_revision: revision, qa_revision: qaRevision, tasks: [task], evidence: [] };
  const update = (document) => tool(box, ['execute', folder, 'build', '--expect', sha(fs.readFileSync(path.join(folder, 'tasks.json')))], document);
  tool(box, ['execute', folder, 'plan', '--expect', 'absent'], plan);
  task.status = 'in_progress';
  update(plan);
  const candidate = tool(box, ['qa', folder, 'candidate', '--project-root', box.project]).candidate;
  const definition = { cwd: box.project, check };
  plan.evidence.push({ id: 'start', event: 'started', task_id: 'T1', check_id: 'check', definition, definition_digest: sha(canonical(definition)), qa_revision: qaRevision, candidate, environment: 'Isolated fixture.' });
  update(plan);
  write(path.join(box.project, '.100x', 'evidence', 'result.json'), JSON.stringify({ dispatch_count: outcome === 'FAIL' ? 1 : 0 }));
  plan.evidence.push({ id: 'result', event: 'result', attempt_id: 'start', status: 'observed', candidate_after: candidate, environment_after: 'Isolated fixture.', exit_code: 0, artifact_ref: '.100x/evidence/result.json', test_refs: ['app.py'], assertions: ['Expect zero.'], observed_values: { dispatch_count: outcome === 'FAIL' ? 1 : 0 } });
  update(plan);
  task.status = 'completed'; task.phase = 'completed';
  update(plan);
  const assessment = { id: 'assessment', candidate, scope_revision: revision, qa_revision: qaRevision, status: outcome, findings: [{ id: 'QA-1', status: outcome, rationale: 'Fixture observation.', evidence_ids: outcome === 'INCONCLUSIVE' ? [] : ['result'] }] };
  tool(box, [outcome === 'PASS' ? 'execute' : 'qa', folder, 'qa-check', '--expect', sha(fs.readFileSync(path.join(folder, 'qa.json')))], assessment);
  return folder;
}

test('a direct engineering task needs no map or formal acceptance contract', () => {
  const box = sandbox();
  start(box, { type: 'direct', visual: false, visualReason: 'This is a headless change.', evidence: 'Unit checks: 3 passed in test.log.' });
  const result = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err + result.out);
  const report = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8');
  assert.match(report, /No formal QA contract/i);
  assert.equal(fs.existsSync(path.join(box.project, 'docs', 'specs')), false);
  assert.equal(fs.existsSync(path.join(box.project, '.project-mapper')), false);
  box.cleanup();
});

test('a headless engineering report does not attach an unrelated old visual matrix', () => {
  const box = sandbox();
  start(box, { type: 'direct', visual: false, visualReason: 'No user interface.', evidence: 'One focused check passed.' });
  write(path.join(box.project, '.100x', 'shots', 'final', 'matrix.json'), JSON.stringify({ matrix: 'all', summary: { totals: { broken: 0, weak: 0, info: 0 }, states: 1, examined: 1 }, viewports: [] }));
  const result = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err + result.out);
  const entry = JSON.parse(cli(['registry', 'list', '--json'], { cwd: box.project, env: box.env }).out)[0];
  assert.equal(entry.matrix, null);
  assert.equal(entry.heroRel, null);
  box.cleanup();
});

test('an engineering task marked visual still requires the visual evidence', () => {
  const box = sandbox();
  start(box, { type: 'direct', visual: true, evidence: 'Layout needs visual verification.' });
  const result = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.notEqual(result.code, 0);
  assert.match(result.out, /hero is missing/);
  assert.match(result.out, /requires a final resolution matrix/);
  box.cleanup();
});

test('the real reviewer brief carries the engineering contract and candidate', () => {
  const box = sandbox();
  fixture(box, 'PASS');
  const brief = cli(['brief', '--print'], { cwd: box.project, env: box.env });
  assert.equal(brief.code, 0, brief.err);
  assert.match(brief.out, /docs[\\/]specs[\\/]cancel-fix/);
  assert.match(brief.out, /qa\.json/);
  assert.match(brief.out, /tasks\.json/);
  assert.match(brief.out, /sha256:/);
  assert.match(brief.out, /INCONCLUSIVE/);
  assert.doesNotMatch(brief.out, /Round 1 of 5|Run it\. Reading code is not a review/);
  assert.equal(cli(['config', 'role', 'review', '--model', 'fixture-reviewer', '--global'], { cwd: box.project, env: box.env }).code, 0);
  const call = cli(['review-call', '--json'], { cwd: box.project, env: box.env });
  const task = JSON.parse(call.out).delegateTask.task;
  assert.match(task, /engineering/i);
  assert.doesNotMatch(task, /prototype|Round 1 of 5/);
  box.cleanup();
});

test('one simulated reviewer is triaged and reported without scheduling prototype rounds', () => {
  const box = sandbox();
  fixture(box, 'PASS');
  assert.equal(cli(['brief'], { cwd: box.project, env: box.env }).code, 0);
  write(path.join(box.project, '.100x', 'review', 'findings.md'), 'No findings.\n\n## Verdict\nReady to ship: yes\n');
  const logged = cli(['log', 'review', 'review started', 'independent fixture', 'simulated reviewer'], { cwd: box.project, env: box.env });
  assert.equal(logged.code, 0, logged.err);
  set(box, 'review', { status: 'reviewed', model: 'deterministic-fixture' });
  const triage = cli(['triage'], { cwd: box.project, env: box.env });
  assert.equal(triage.code, 0, triage.err);
  assert.doesNotMatch(triage.out, /Next, `100x brief`/);
  const done = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(done.code, 0, done.err + done.out);
  const report = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8');
  assert.match(report, /deterministic-fixture/);
  assert.doesNotMatch(report, /1 of 5/);
  assert.doesNotMatch(report, /No check was recorded for the one thing/);
  box.cleanup();
});

for (const outcome of ['PASS', 'FAIL', 'INCONCLUSIVE']) {
  test(`planned headless completion preserves ${outcome} and current-candidate evidence`, () => {
    const box = sandbox();
    fixture(box, outcome);
    if (outcome !== 'PASS') {
      const refused = cli(['finish', '--check'], { cwd: box.project, env: box.env });
      assert.notEqual(refused.code, 0, 'a non-PASS assessment cannot support a ship verdict');
      set(box, 'verdict', 'dud');
      set(box, 'verdictWhy', `The acceptance assessment was ${outcome}.`);
    }
    const done = cli(['finish'], { cwd: box.project, env: box.env });
    assert.equal(done.code, 0, done.err + done.out);
    const report = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8');
    assert.match(report, new RegExp(`Acceptance at finish: ${outcome}`));
    assert.match(report, /QA-1/);
    assert.match(report, /sha256:/);
    box.cleanup();
  });
}

test('changed candidate and stale contracts cannot keep a positive verdict', () => {
  const box = sandbox();
  const folder = fixture(box, 'PASS');
  fs.appendFileSync(path.join(box.project, 'app.py'), '\n# candidate changed\n');
  let check = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.notEqual(check.code, 0);
  assert.match(check.out, /INCONCLUSIVE/);
  fs.appendFileSync(path.join(folder, 'SCOPE.md'), '\nChanged requirement.\n');
  check = cli(['finish', '--check'], { cwd: box.project, env: box.env });
  assert.notEqual(check.code, 0);
  assert.match(check.out, /stale/i);
  box.cleanup();
});

test('a rebuilt report identifies a former PASS as historical after the candidate changes', () => {
  const box = sandbox();
  fixture(box, 'PASS');
  const done = cli(['finish'], { cwd: box.project, env: box.env });
  assert.equal(done.code, 0, done.err + done.out);
  fs.appendFileSync(path.join(box.project, 'app.py'), '\n# changed after finish\n');
  const report = cli(['report', '--print'], { cwd: box.project, env: box.env });
  assert.equal(report.code, 0, report.err);
  assert.match(report.out, /Acceptance at finish: PASS/);
  assert.match(report.out, /Current acceptance: INCONCLUSIVE/);
  assert.match(report.out, /historical/i);
  const page = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.html'), 'utf8');
  assert.match(page, /Current acceptance: INCONCLUSIVE/);
  const morning = cli(['morning', '--all'], { cwd: box.project, env: box.env });
  assert.equal(morning.code, 0, morning.err);
  assert.match(morning.out, /Current acceptance is INCONCLUSIVE/);
  const gallery = fs.readFileSync(path.join(box.env.X100_HOME, 'morning', 'index.html'), 'utf8');
  assert.match(gallery, /data-filter="stale-acceptance"/);
  assert.match(gallery, /Current acceptance: INCONCLUSIVE/);
  assert.doesNotMatch(morning.out, /undefined/);
  box.cleanup();
});

test('a malformed assessment cannot leave a false completion marker', () => {
  const box = sandbox();
  const folder = fixture(box, 'PASS');
  const file = path.join(folder, 'qa.json');
  const qa = JSON.parse(fs.readFileSync(file, 'utf8'));
  qa.assessments[0].findings[0].evidence_ids = 'result';
  fs.writeFileSync(file, JSON.stringify(qa));
  const result = cli(['finish'], { cwd: box.project, env: box.env });
  assert.notEqual(result.code, 0);
  assert.match(result.err, /evidence_ids must be a list/i);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'finished.json')), false);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'REPORT.md')), false);
  box.cleanup();
});
