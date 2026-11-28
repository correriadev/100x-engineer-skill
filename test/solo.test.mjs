import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { challengeProblems, challengeTemplate, isSolo, loopFindingCount, readChallenge, seatFor, soloProof, CHALLENGES, CHALLENGE_NAMES } from '../lib/solo.mjs';
import { trustLine } from '../lib/look-first.mjs';
import { pointsAtSomething } from '../lib/review.mjs';
import { cli, sandbox, write } from './helpers.mjs';
import { FINDINGS, makeProject, runJson } from './projects.mjs';

const run = (box, ...args) => cli(args, { cwd: box.project, env: box.env });
const finish = (box) => run(box, 'finish');
const dot = (box, ...parts) => path.join(box.project, '.100x', ...parts);

const SEAT = 'a stranger on a fresh clone who owes the builder nothing';
const items = (count, { broken = 0, prefix = 'S' } = {}) => Array.from({ length: count }, (_, i) => `- ${prefix}${i + 1} claim ${i + 1} could be false. Proof: \`npm test\` printed ${i + 1} passing. Result: ${i < broken ? 'broken' : 'holds'}`).join('\n');

// A challenge file the way a model fills in the template.
function challenge({ suspicions = 5, broken = 0, recheck = 3, verdict, seat = SEAT, recheckSeat = 'a user on the slowest phone', fixes = true } = {}) {
  return `# Challenge
Seat: ${seat}

## Suspicions
${items(suspicions, { broken })}

## Recheck
${recheckSeat ? `Seat: ${recheckSeat}\n` : ''}${recheck ? items(recheck, { prefix: 'R' }) : ''}

## Fixes
${broken && fixes ? '- S1 fixed in a1b2c3d, then `npm test` passed again\n' : ''}
Verdict: ${verdict ?? (broken ? 'fixed' : 'holds')}
`;
}

const SOLO_FINDINGS = `# Findings
Seat: a staff engineer who is paged when this breaks and did not write it

## Suspicions
${items(8)}

${FINDINGS.replace('# Findings\n', '').trimStart()}`;

const LOOP_JUDGE = `Judged by: looking at the screenshots
Seat: a stranger on a phone who did not build this

## Suspicions
${items(5)}

Rechecked: a user on the slowest phone found no clipped button at 320px
Drifting: no
Better: yes
`;
// The same file with one broken suspicion and the finding that goes with it, in the shape the printed steps ask for.
const loopWithFinding = (line) => LOOP_JUDGE.replace('Result: holds', 'Result: broken').replace('\nRechecked', `\n## Findings\n${line}\n\nRechecked`);

const soloRun = (overrides = {}) => runJson({ mode: 'solo', review: { status: 'reviewed', model: 'claude-sonnet-5-5', flags: 2, fixed: 1 }, ...overrides });

// A run that finishes: every owed challenge written, each round and loop holding its suspicions.
function soloProject(box, { files = ['plan', 'build', 'depth', 'properties'], findings = SOLO_FINDINGS, runFile = soloRun(), loop = LOOP_JUDGE } = {}) {
  makeProject(box, { run: runFile, findings });
  for (const name of files) write(dot(box, 'solo', `${name}.md`), challenge());
  for (let pass = 1; pass <= 3; pass += 1) write(dot(box, 'loops', `pass-${pass}`, 'judge.md'), loop);
  return box.project;
}

function bareSolo(box) {
  run(box, 'init', '--no-git');
  const set = run(box, 'run', 'set', 'mode', 'solo');
  assert.equal(set.code, 0, set.err);
}

test('run set accepts mode solo and says mockup or solo when it is anything else', () => {
  const box = sandbox();
  run(box, 'init', '--no-git');
  const bad = run(box, 'run', 'set', 'mode', 'fast');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /mode can only be mockup, solo or engineering/);
  assert.equal(run(box, 'run', 'set', 'mode', 'solo').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(dot(box, 'run.json'), 'utf8')).mode, 'solo');
  box.cleanup();
});

test('the solo flag is one way: a solo run cannot unset it or change it, and setting it again is harmless', () => {
  const box = sandbox();
  bareSolo(box);
  for (const args of [['unset', 'mode'], ['set', 'mode', 'mockup'], ['set', 'mode', 'fast']]) {
    const result = run(box, 'run', ...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /the solo flag stays for the life of the run/);
  }
  assert.equal(run(box, 'run', 'set', 'mode', 'solo').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(dot(box, 'run.json'), 'utf8')).mode, 'solo');
  // The owner can still change it by hand, and a normal run is never held to this.
  const plain = sandbox();
  run(plain, 'init', '--no-git');
  assert.equal(run(plain, 'run', 'set', 'mode', 'mockup').code, 0);
  assert.equal(run(plain, 'run', 'unset', 'mode').code, 0);
  plain.cleanup();
  box.cleanup();
});

test('a damaged run.json does not make the solo guard the command that fails', () => {
  const box = sandbox();
  run(box, 'init', '--no-git');
  fs.writeFileSync(dot(box, 'run.json'), '{bad json');
  const helper = run(box, 'helper', 'run', '--task', 'x');
  assert.doesNotMatch(helper.err, /solo/);
  assert.match(helper.err, /--model/);
  box.cleanup();
});

test('in a solo run no command starts another model: a helper, a judge command and a night all refuse', () => {
  const box = sandbox();
  bareSolo(box);
  const helper = run(box, 'helper', 'run', '--model', 'muse-wonder-1.0', '--task', 'judge this');
  assert.equal(helper.code, 1);
  assert.match(helper.err, /solo run .* no other model starts: a helper/);
  const elsewhere = path.join(box.dir, 'elsewhere');
  fs.mkdirSync(elsewhere);
  const reached = cli(['helper', 'run', '--model', 'muse-wonder-1.0', '--task', 'judge this', '--cwd', box.project], { cwd: elsewhere, env: box.env });
  assert.match(reached.err, /solo run/, 'a helper pointed at a solo project from outside it is refused too');
  const command = run(box, 'review-run');
  assert.equal(command.code, 1);
  assert.match(command.err, /solo run .* a judge command/);
  const night = run(box, 'night', 'start', '--until', '23:59', '--brief', 'an oats app');
  assert.equal(night.code, 1);
  assert.match(night.err, /solo run .* a child for a night/);
  box.cleanup();
});

test('a normal run is not touched: a helper there does not mention solo, and `100x solo` says what a solo run is', () => {
  const box = sandbox();
  run(box, 'init', '--no-git');
  const helper = run(box, 'helper', 'run', '--model', 'muse-wonder-1.0', '--task', 'judge this');
  assert.doesNotMatch(helper.err, /solo/);
  const solo = run(box, 'solo');
  assert.equal(solo.code, 1);
  assert.match(solo.err, /This is not a solo run/);
  box.cleanup();
});

test('review-call in a solo run starts nothing, ignores review.enabled and says where the files are', () => {
  const box = sandbox();
  bareSolo(box);
  run(box, 'config', 'set', 'review.enabled', 'false', '--local');
  const json = JSON.parse(run(box, 'review-call', '--json').out);
  assert.equal(json.solo, true);
  assert.equal(json.via, 'self');
  assert.equal(json.enabled, true);
  assert.equal(json.delegateTask, undefined, 'there is no task for another model');
  const text = run(box, 'review-call').out;
  assert.match(text, /^Solo round 1 of \d, the code and how it behaves\. No judge starts: you judge it yourself\./);
  assert.match(text, /Write the suspicions before you run anything/);
  assert.doesNotMatch(text, /delegateTask|review-run|subagent tool/);
  box.cleanup();
});

test('review-call --loop in a solo run prints the steps of judging a loop yourself, ask file first', () => {
  const box = sandbox();
  bareSolo(box);
  const early = run(box, 'review-call', '--loop', 'pass-1');
  assert.equal(early.code, 1);
  assert.match(early.err, /No ask file for loop pass-1/);
  write(dot(box, 'loops', 'pass-1', 'ask.md'), 'What this loop tried.\n');
  const out = run(box, 'review-call', '--loop', 'pass-1').out;
  assert.match(out, /^Solo loop pass-1\. No judge starts/);
  assert.match(out, /Sit in this chair: a stranger on a phone/);
  assert.match(out, /at least 5 suspicions/);
  assert.match(out, /Rechecked:/);
  assert.match(out, /Only now write .*answers\.md/);
  const json = JSON.parse(run(box, 'review-call', '--json', '--loop', 'pass-1').out);
  assert.equal(json.steps.length, 11, 'a heading line and ten steps');
  box.cleanup();
});

test('the brief of a solo round is written for the builder in another chair, and keeps the formats the triage reads', () => {
  const box = sandbox();
  bareSolo(box);
  const made = run(box, 'brief');
  assert.equal(made.code, 0, made.err);
  const brief = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.match(brief, /You built this, and now you judge it\. This is a solo run/);
  assert.match(brief, /Your seat this round: a staff engineer who is paged when this breaks/);
  assert.match(brief, /at least 8 suspicions under "## Suspicions"/);
  assert.match(brief, /Fixes come after triage, never during the look/);
  assert.match(brief, /A look that finds nothing is suspect/);
  assert.match(brief, /## Findings format/);
  assert.doesNotMatch(brief, /Another AI model built this/);
  assert.doesNotMatch(brief, /Write only .*findings\.md, plus screenshots/);
  box.cleanup();
});

test('a normal brief is unchanged: another model judges, and no seat or suspicions are asked for', () => {
  const box = sandbox();
  run(box, 'init', '--no-git');
  run(box, 'brief');
  const brief = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.match(brief, /Another AI model built this and thinks it is good/);
  assert.doesNotMatch(brief, /Suspicions|Your seat this round/);
  box.cleanup();
});

test('100x solo new writes the template for a stage, refuses to overwrite it and a name it does not know', () => {
  const box = sandbox();
  bareSolo(box);
  const made = run(box, 'solo', 'new', 'build');
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /Wrote \.100x\/solo\/build\.md\. Stage 2/);
  assert.match(made.out, /Let's analyze this\. Is it correct\? Is it good\? Be brutal\./);
  const text = fs.readFileSync(dot(box, 'solo', 'build.md'), 'utf8');
  assert.equal(text, challengeTemplate('build'));
  assert.match(text, /^Seat: a stranger on a fresh clone/m);
  assert.match(text, /Do not reread STATE\.md/);
  const again = run(box, 'solo', 'new', 'build');
  assert.equal(again.code, 1);
  assert.match(again.err, /already exists\. .*Nothing was overwritten/);
  assert.match(run(box, 'solo', 'new', 'dessert').err, /takes plan, core, build, depth, properties\. Got "dessert"/);
  box.cleanup();
});

test('an empty template is not a passing challenge, and every template is a file the check can read', () => {
  for (const name of CHALLENGE_NAMES) {
    const problems = challengeProblems(challengeTemplate(name), CHALLENGES[name], pointsAtSomething);
    assert.ok(problems.some((problem) => /holds 0 suspicions/.test(problem)), `${name} template passes as if it were done`);
    assert.ok(problems.some((problem) => /no verdict yet/.test(problem)));
    assert.equal(readChallenge(challengeTemplate(name)).seat, CHALLENGES[name].seat);
  }
});

test('a challenge passes with enough suspicions that have proof, a recheck from another seat, and a closed verdict', () => {
  const spec = { min: 5 };
  assert.deepEqual(challengeProblems(challenge(), spec, pointsAtSomething), []);
  assert.ok(challengeProblems(challenge({ suspicions: 4 }), spec, pointsAtSomething).some((p) => /holds 4 suspicions .* at least 5/.test(p)));
  assert.ok(challengeProblems(challenge({ recheck: 2 }), spec, pointsAtSomething).some((p) => /"## Recheck" needs at least 3 list items and has 2/.test(p)));
  assert.ok(challengeProblems(challenge({ recheckSeat: SEAT }), spec, pointsAtSomething).some((p) => /same seat in "## Recheck"/.test(p)));
  assert.ok(challengeProblems(challenge({ recheckSeat: '' }), spec, pointsAtSomething).some((p) => /no "Seat:" line under "## Recheck"/.test(p)));
  assert.ok(challengeProblems(challenge({ seat: '<who>' }), spec, pointsAtSomething).some((p) => /no "Seat:" line before the first heading/.test(p)));
  assert.ok(challengeProblems(challenge({ verdict: 'open' }), spec, pointsAtSomething).some((p) => /no verdict yet/.test(p)));
});

test('a suspicion without proof or a result does not count, and "it looks fine" is not proof', () => {
  const weak = challenge().replace('Proof: `npm test` printed 1 passing', 'Proof: it looks fine to me').replace(/Result: holds/, 'Result: probably');
  const problems = challengeProblems(weak, { min: 5 }, pointsAtSomething);
  assert.ok(problems.some((p) => /suspicion 1 .* has no proof/.test(p)));
  assert.ok(problems.some((p) => /suspicion 1 .* says no result/.test(p)));
});

test('a broken suspicion has to be fixed and run again, and a verdict of holds cannot hide it', () => {
  const spec = { min: 5 };
  assert.deepEqual(challengeProblems(challenge({ broken: 1, recheck: 0, recheckSeat: '' }), spec, pointsAtSomething), [], 'broken, fixed, run again: nothing more is asked');
  assert.ok(challengeProblems(challenge({ broken: 2, verdict: 'holds' }), spec, pointsAtSomething).some((p) => /2 broken suspicions and the verdict holds/.test(p)));
  assert.ok(challengeProblems(challenge({ broken: 1, fixes: false }), spec, pointsAtSomething).some((p) => /no list item under "## Fixes"/.test(p)));
  assert.ok(challengeProblems(challenge({ verdict: 'fixed' }), spec, pointsAtSomething).some((p) => /says fixed, and no suspicion is broken/.test(p)));
  const vague = challenge({ broken: 1 }).replace('- S1 fixed in a1b2c3d, then `npm test` passed again', '- made it better');
  assert.ok(challengeProblems(vague, spec, pointsAtSomething).some((p) => /fix 1 .* names no commit, path or command/.test(p)));
});

test('a recheck that finds a break counts: the stage is then fixed or it does not pass', () => {
  const text = challenge({ recheck: 3 }).replace('R2 claim 2 could be false. Proof: `npm test` printed 2 passing. Result: holds', 'R2 claim 2 could be false. Proof: `npm test` printed 2 failing. Result: broken');
  const problems = challengeProblems(text, { min: 5 }, pointsAtSomething);
  assert.ok(problems.some((p) => /1 broken suspicion and the verdict holds/.test(p)));
});

test('100x solo check names what each owed challenge lacks, and passes when they are written', () => {
  const box = sandbox();
  soloProject(box, { files: [] });
  const first = run(box, 'solo');
  assert.equal(first.code, 1);
  assert.match(first.out, /plan\s+NOT YET\s+\.100x\/solo\/plan\.md\n\s+is missing\. Stage 0.* `100x solo new plan`/);
  assert.match(first.out, /build\s+NOT YET/);
  assert.match(first.out, /depth\s+NOT YET/, 'the run has features, so depth happened');
  assert.match(first.out, /properties\s+NOT YET/, 'the ledger has a row');
  assert.match(first.out, /core\s+not owed yet\. Stage 1/, 'no core row was logged');
  for (const name of ['plan', 'build', 'depth', 'properties']) write(dot(box, 'solo', `${name}.md`), challenge());
  const done = run(box, 'solo');
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /4 of 4 owed challenges pass\./);
  const json = JSON.parse(run(box, 'solo', 'check', '--json').out);
  assert.ok(json.challenges.every((entry) => entry.ok));
  box.cleanup();
});

test('a core row in the log makes the core challenge owed', () => {
  const box = sandbox();
  soloProject(box);
  assert.match(run(box, 'solo').out, /core\s+not owed yet/);
  run(box, 'log', 'core', 'proceed 5 of 6 on the glow', 'the slice', 'shots', 'ship');
  const out = run(box, 'solo');
  assert.equal(out.code, 1);
  assert.match(out.out, /core\s+NOT YET\s+\.100x\/solo\/core\.md\n\s+is missing\. Stage 1/);
  box.cleanup();
});

test('finish closes a solo run whose challenges, rounds and loops hold up, and the report says nobody else looked', () => {
  const box = sandbox();
  soloProject(box);
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const entry = JSON.parse(fs.readFileSync(dot(box, 'run.json'), 'utf8'));
  assert.equal(entry.mode, 'solo');
  assert.equal(entry.review.solo, true);
  assert.equal(entry.review.sameAsBuilder, true, 'the judge is the builder by definition, whatever the settings say');
  const report = fs.readFileSync(dot(box, 'REPORT.md'), 'utf8');
  assert.match(report, /claude-sonnet-5-5, the same model that built it\. A solo run, so no other model looked/);
  assert.match(done.out, /Review \(claude-sonnet-5-5\): [^\n]*\nJudged by: the same model that built it\. A solo run, so no other model looked\n/);
  const trust = trustLine(entry);
  assert.equal(trust.tone, 'warn', 'the card is not painted as a run a judge cleared');
  assert.match(trust.text, /A solo run: the model that built it judged it and no other model looked/);
  assert.doesNotMatch(trust.text, /The judge was the model that built it/);
  const list = run(box, 'registry', 'list');
  assert.match(list.out, /Glow \(solo\)/);
  box.cleanup();
});

test('finish refuses a solo run with no plan challenge, and says the command that writes it', () => {
  const box = sandbox();
  soloProject(box, { files: ['build', 'depth', 'properties'] });
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /solo\. \.100x\/solo\/plan\.md is missing\. Stage 0.*`100x solo new plan`/);
  assert.ok(!fs.existsSync(dot(box, 'finished.json')));
  box.cleanup();
});

test('finish refuses a solo run that started a helper, whatever the helper did', () => {
  const box = sandbox();
  soloProject(box);
  write(dot(box, 'helpers.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), model: 'muse-wonder-1.0', status: 'finished', seconds: 90, tokens: 1000, agentId: 'a1' })}\n`);
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /solo\. run\.json says mode solo, but \.100x\/helpers\.jsonl holds 1 helper run\. A solo run starts no other model/);
  box.cleanup();
});

test('finish refuses a solo run when a judge command was started', () => {
  const box = sandbox();
  soloProject(box);
  write(dot(box, 'review', 'run.json'), '{"pid":1}\n');
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /solo\. a judge command was started with `100x review-run`/);
  box.cleanup();
});

test('finish refuses a solo round that did not write its suspicions first, and one that lost a broken suspicion', () => {
  const box = sandbox();
  soloProject(box, { findings: FINDINGS });
  const bare = finish(box);
  assert.equal(bare.code, 1);
  assert.match(bare.err, /solo\. (the open round|round 1), findings\.md holds 0 suspicions under "## Suspicions" and needs at least 8, written before the checks/);
  box.cleanup();
  const lost = sandbox();
  soloProject(lost, { findings: SOLO_FINDINGS.replace('Proof: `npm test` printed 1 passing. Result: holds', 'Proof: `npm test` printed 1 failing. Result: broken').replace(/## F1 .*\n/, '## Note\n').replace(/## F2 .*\n/, '## Other\n') });
  const result = finish(lost);
  assert.equal(result.code, 1);
  assert.match(result.err, /1 broken suspicion and 0 findings\. A suspicion that came out broken is a finding, with a severity/);
  lost.cleanup();
});

test('finish refuses a solo loop whose judge file holds no suspicions, and ignores review.enabled false', () => {
  const box = sandbox();
  soloProject(box, { loop: 'Judged by: looking\nDrifting: no\nBetter: yes\n' });
  run(box, 'config', 'set', 'review.enabled', 'false', '--local');
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /solo\. loop pass-1, judge\.md holds 0 suspicions under "## Suspicions" and needs at least 5/);
  box.cleanup();
});

test('a solo loop that has no files at all says it has no challenge, not that the builder graded itself', () => {
  const box = sandbox();
  soloProject(box);
  fs.rmSync(dot(box, 'loops', 'pass-2', 'answers.md'));
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /loop pass-2 has no challenge\. Write .*ask\.md, run `100x review-call --loop pass-2` for the steps/);
  assert.doesNotMatch(result.err, /grades itself/);
  box.cleanup();
});

test('a solo run cannot call itself unreviewed because a judge failed to start: no judge can fail', () => {
  const box = sandbox();
  soloProject(box, { runFile: soloRun({ review: { status: 'unreviewed', note: 'the judge could not start' } }) });
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /a solo run judges itself, so no judge can fail to start/);
  box.cleanup();
});

test('a solo run with no time left for a round may finish unreviewed, and says so', () => {
  const box = sandbox();
  soloProject(box, { runFile: soloRun({ review: { status: 'unreviewed', note: 'no time left for a round: 4 min on the clock' } }) });
  run(box, 'clock', 'set', '+10m');
  const result = finish(box);
  assert.equal(result.code, 0, result.err + result.out);
  assert.ok(fs.existsSync(dot(box, 'finished.json')));
  assert.match(result.out, /UNREVIEWED/);
  box.cleanup();
});

test('a clock set at the end of the run cannot say there was no room for a round', () => {
  const box = sandbox();
  soloProject(box, { runFile: soloRun({ review: { status: 'unreviewed', note: 'no time left for a round: 4 min on the clock' } }) });
  const began = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  write(dot(box, 'decisions.tsv'), `ts\tphase\tdecision\twhy\tevidence\tresult\n${began}\tframe\tthe plan\tthe brief\tproject.md\tok\n`);
  run(box, 'clock', 'set', '+10m');
  const result = finish(box);
  assert.equal(result.code, 1);
  assert.match(result.err, /review\.status is unreviewed, but the clock was set at .* and the run began at .*cannot say there was no room for a round/);
  assert.ok(!fs.existsSync(dot(box, 'finished.json')));
  box.cleanup();
});

test('a dud variant of a solo run may end with no review: finish raises no solo error for it', () => {
  const box = sandbox();
  soloProject(box, { runFile: soloRun({ verdict: 'dud', review: { status: 'unreviewed', note: 'a dud after its pivots, so no review' } }) });
  const result = finish(box);
  assert.doesNotMatch(result.err, /a solo run judges itself|review\.status is unreviewed, but/);
  box.cleanup();
});

test('a proof is a command, a file or a commit: a bare number is not one', () => {
  for (const proof of ['1', '12', '1234567', 'it looked fine', '42 passing', 'and/or it worked', 'e.g. it worked', 'a/b testing showed it', '`ok`']) assert.equal(soloProof(proof), false, proof);
  for (const proof of ['`npm test` printed 12 passing', 'shots/review/phone-320.png', 'a1b2c3d', 'src/app.js line 4', 'README.md', '`ls -la`', '`make`', '.100x/review/findings.md']) assert.equal(soloProof(proof), true, proof);
});

test('a suspicion needs an id, ids are not reused, and a fix names the suspicion it fixes', () => {
  const body = (extra) => `# Challenge\nSeat: ${SEAT}\n\n## Suspicions\n${extra}\n\n## Recheck\nSeat: a user on the slowest phone\n${items(3, { prefix: 'R' })}\n\n## Fixes\n`;
  const five = items(5);
  const noId = challengeProblems(body(five.replace('- S1 ', '- ')), { min: 5 }, soloProof);
  assert.ok(noId.some((problem) => /has no id\. Start it with S1/.test(problem)), noId.join('\n'));
  const twice = challengeProblems(body(five.replace('- S2 ', '- S1 ')), { min: 5 }, soloProof);
  assert.ok(twice.some((problem) => /reuses the id S1/.test(problem)), twice.join('\n'));
  // Two broken, one fix that names only the first.
  const two = `# Challenge\nSeat: ${SEAT}\n\n## Suspicions\n${items(5, { broken: 2 })}\n\n## Fixes\n- S1 fixed in a1b2c3d, then \`npm test\` passed again\n\nVerdict: fixed\n`;
  const lost = challengeProblems(two, { min: 5 }, soloProof);
  assert.deepEqual(lost, ['S2 came out broken and no fix starts with it. Start its item under "## Fixes" with S2']);
  const both = two.replace('- S1 fixed in a1b2c3d, then `npm test` passed again', '- S1 fixed in a1b2c3d, then `npm test` passed again\n- S2 fixed in 9f8e7d6, then `npm test` passed again');
  assert.deepEqual(challengeProblems(both, { min: 5 }, soloProof), []);
  // A recheck that breaks is named the same way.
  const recheckBreak = `# Challenge\nSeat: ${SEAT}\n\n## Suspicions\n${items(5)}\n\n## Recheck\nSeat: a user on the slowest phone\n${items(3, { prefix: 'R', broken: 1 })}\n\n## Fixes\n- fixed it in a1b2c3d, then \`npm test\` passed\n\nVerdict: fixed\n`;
  assert.deepEqual(challengeProblems(recheckBreak, { min: 5 }, soloProof), ['R1 came out broken and no fix starts with it. Start its item under "## Fixes" with R1']);
});

test('a skipped core leaves no core challenge owed', () => {
  const box = sandbox();
  soloProject(box);
  run(box, 'log', 'core', 'skipped: a big change with a clear spec', 'core.enabled is not needed here', 'none', 'skipped');
  assert.match(run(box, 'solo').out, /core\s+not owed yet/);
  box.cleanup();
});

test('a round that names no seat, and one that found nothing and did not look again, do not pass', () => {
  const noSeat = sandbox();
  soloProject(noSeat, { findings: SOLO_FINDINGS.replace(/^Seat: .*\n/m, '') });
  const first = finish(noSeat);
  assert.equal(first.code, 1);
  assert.match(first.err, /solo\. (the open round|round 1), findings\.md has no "Seat:" line before the first heading/);
  noSeat.cleanup();
  const clean = sandbox();
  const none = SOLO_FINDINGS.replace(/## F1 .*\n/, '## Note\n').replace(/## F2 .*\n/, '## Other\n');
  soloProject(clean, { findings: none });
  const second = finish(clean);
  assert.equal(second.code, 1);
  assert.match(second.err, /has no findings and no "Rechecked:" line/);
  clean.cleanup();
  const looked = sandbox();
  soloProject(looked, { findings: `${none}\nRechecked: a user on the slowest phone found no clipped button at 320px\n` });
  assert.doesNotMatch(finish(looked).err, /Rechecked/);
  looked.cleanup();
});

test('a loop whose judge file has a broken suspicion and no finding does not pass', () => {
  const box = sandbox();
  soloProject(box, { loop: LOOP_JUDGE.replace('Result: holds', 'Result: broken') });
  const lost = finish(box);
  assert.equal(lost.code, 1);
  assert.match(lost.err, /solo\. loop pass-1, judge\.md has 1 broken suspicion and 0 findings/);
  box.cleanup();
  // Whatever shape the finding has, it counts and does not become a suspicion without an id.
  for (const line of ['- major: the buy button is cut off at 320px', '- F1 [major] the buy button is cut off at 320px', '- [major] the buy button is cut off at 320px', 'major, the buy button is cut off at 320px']) {
    const kept = sandbox();
    soloProject(kept, { loop: loopWithFinding(line) });
    const result = finish(kept);
    assert.doesNotMatch(result.err, /broken suspicion|no id|no proof|says no result/, line);
    assert.equal(result.code, 0, `${line}\n${result.err}`);
    kept.cleanup();
  }
});

test('the brief of a solo round leaves out the builder\'s commits and decision notes, and two rounds of one lens take two seats', () => {
  const box = sandbox();
  soloProject(box);
  run(box, 'log', 'frame', 'chose a ring buffer because the owner wanted speed', 'the brief', 'project.md', 'ok');
  const brief = run(box, 'brief').out + fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.doesNotMatch(brief, /ring buffer/);
  assert.doesNotMatch(brief, /Last decisions|Recent commits/);
  assert.match(brief, /Your seat this round: /);
  assert.notEqual(seatFor('code', 0), seatFor('code', 1));
  assert.notEqual(seatFor('product', 0), seatFor('product', 1));
  box.cleanup();
});

test('isSolo is false for a folder with no run and for a damaged run file', () => {
  const box = sandbox();
  assert.equal(isSolo(null), false);
  assert.equal(isSolo(box.project), false);
  run(box, 'init', '--no-git');
  fs.writeFileSync(dot(box, 'run.json'), '{bad json');
  assert.equal(isSolo(box.project), false);
  box.cleanup();
});

test('the solo flag cannot be reached through a dotted key, and a quoted solo is the same as solo', () => {
  const box = sandbox();
  bareSolo(box);
  for (const args of [['set', 'mode.foo', 'bar'], ['push', 'mode', 'x'], ['unset', 'mode.foo']]) {
    const result = run(box, 'run', ...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /the solo flag stays for the life of the run/);
  }
  assert.equal(run(box, 'run', 'set', 'mode', '"solo"').code, 0);
  assert.equal(JSON.parse(fs.readFileSync(dot(box, 'run.json'), 'utf8')).mode, 'solo');
  box.cleanup();
});

test('a fresh run after a solo run with a helper starts clean: the old challenge files are archived and the old helper is not counted', () => {
  const box = sandbox();
  soloProject(box);
  fs.writeFileSync(dot(box, 'helpers.jsonl'), `${JSON.stringify({ at: new Date(Date.now() - 3 * 86400000).toISOString(), model: 'old', status: 'finished' })}\n`);
  const fresh = run(box, 'init', '--fresh', '--no-git');
  assert.equal(fresh.code, 0, fresh.err);
  assert.ok(!fs.existsSync(dot(box, 'solo')), 'the old challenge files moved with the run');
  assert.equal(run(box, 'run', 'set', 'mode', 'solo').code, 0);
  assert.equal(run(box, 'solo', 'new', 'plan').code, 0);
  box.cleanup();
});

test('the printed steps of a loop, followed literally, produce a file that finish accepts, with findings in any of the repository shapes', () => {
  assert.equal(loopFindingCount('## F1 [major] clipped\n- F2 [minor] dim\n- [nit] odd\nmajor: x\n1. blocker y\nS1 major flaw. Proof: `a b`. Result: holds'), 5);
  const text = readChallenge(`Judged by: looking\nSeat: a stranger\n\n## Suspicions\n${items(5, { broken: 1 })}\n- F1 [major] the button is clipped (S1)\n- minor: dim hint\n\n## Findings\n- nit: spacing\n`);
  assert.equal(text.suspicions.length, 5, 'a finding written under the suspicions ends the list');
});

test('a loop that found nothing needs a Rechecked line and a Seat line', () => {
  const noSeat = sandbox();
  soloProject(noSeat, { loop: LOOP_JUDGE.replace(/^Seat: .*\n/m, '') });
  assert.match(finish(noSeat).err, /solo\. loop pass-1, judge\.md has no "Seat:" line/);
  noSeat.cleanup();
  const noLook = sandbox();
  soloProject(noLook, { loop: LOOP_JUDGE.replace(/^Rechecked: .*\n/m, '') });
  assert.match(finish(noLook).err, /solo\. loop pass-1, judge\.md has no findings and no "Rechecked:" line/);
  noLook.cleanup();
});

test('recheck items are held to the rules even when something broke, bold on Seat and Verdict is read, and a fix has to start with the id', () => {
  const body = (recheck, fixes, verdict = 'fixed') => `# Challenge\n**Seat:** ${SEAT}\n\n## Suspicions\n${items(5, { broken: 1 })}\n\n## Recheck\nSeat: a user on the slowest phone\n${recheck}\n\n## Fixes\n${fixes}\n\n**Verdict: ${verdict}**\n`;
  const fix = '- S1 fixed in a1b2c3d, then `npm test` passed again';
  assert.deepEqual(challengeProblems(body(items(3, { prefix: 'R' }), fix), { min: 5 }, soloProof), []);
  const junk = challengeProblems(body('- an item with no id, no proof and no result\n- S1 reused a suspicion id. Proof: `npm test` printed it. Result: holds', fix), { min: 5 }, soloProof);
  assert.ok(junk.some((problem) => /recheck item 1 .* has no id/.test(problem)), junk.join('\n'));
  assert.ok(junk.some((problem) => /recheck item 1 .* has no proof/.test(problem)), junk.join('\n'));
  const loose = challengeProblems(body(items(3, { prefix: 'R' }), '- Fixed the tap bug (S1) in a1b2c3d, then `npm test` passed'), { min: 5 }, soloProof);
  assert.deepEqual(loose, ['S1 came out broken and no fix starts with it. Start its item under "## Fixes" with S1']);
});

test('a skip of the core in any wording owes no core challenge, and a dud variant owes no build challenge', () => {
  const box = sandbox();
  soloProject(box);
  run(box, 'log', 'core', 'Core skipped: core.enabled is false', 'why', 'none', 'ok');
  assert.match(run(box, 'solo').out, /core\s+not owed yet/);
  box.cleanup();
  const dud = sandbox();
  soloProject(dud, { runFile: soloRun({ verdict: 'dud', review: { status: 'unreviewed', note: 'a dud' } }), files: ['plan'] });
  assert.match(run(dud, 'solo').out, /build\s+not owed yet/);
  dud.cleanup();
});

test('two rounds in a row cannot carry the same seat, and a clock set days before the run is not the run\'s clock', () => {
  const box = sandbox();
  soloProject(box, { findings: SOLO_FINDINGS });
  const first = path.join(dot(box, 'review'), 'round-1');
  write(path.join(first, 'findings.md'), `${SOLO_FINDINGS}\nAn earlier round.\n`);
  write(dot(box, 'review', 'rounds.json'), JSON.stringify({ entries: [{ slot: 1, closedAt: new Date().toISOString() }], current: null }));
  const result = finish(box);
  assert.match(result.err, /solo\. the open round, findings\.md has the same seat as the round before/);
  box.cleanup();
  const old = sandbox();
  soloProject(old, { runFile: soloRun({ review: { status: 'unreviewed', note: 'no time left for a round' } }) });
  run(old, 'clock', 'set', '+10m');
  const clock = JSON.parse(fs.readFileSync(dot(old, 'clock.json'), 'utf8'));
  clock.setAt = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  clock.deadline = new Date(Date.now() + 10 * 60000).toISOString();
  fs.writeFileSync(dot(old, 'clock.json'), JSON.stringify(clock));
  assert.match(finish(old).err, /cannot say there was no room for a round/);
  old.cleanup();
});

test('the brief of round 2 keeps the builder\'s commit messages out, counts the commits, and names the second seat of the lens', () => {
  const box = sandbox();
  const git = (...args) => execFileSync('git', args, { cwd: box.project, env: { ...process.env, ...box.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdio: 'pipe' });
  fs.mkdirSync(box.project, { recursive: true });
  git('init', '-q', '.');
  write(path.join(box.project, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  assert.equal(run(box, 'init').code, 0);
  assert.equal(run(box, 'run', 'set', 'mode', 'solo').code, 0);
  assert.equal(run(box, 'brief').code, 0);
  const one = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.match(one, /Your seat this round: a staff engineer who is paged/);
  write(dot(box, 'review', 'findings.md'), `# Findings\nSeat: a staff engineer\n\n## F1 [major] The button is clipped\nWhere: 320px\nEvidence: shots/a.png\nFix: wrap\n\n## Verdict\nReady to ship: no\n`);
  write(dot(box, 'review', 'triage.md'), 'F1 accept. fixed in the next commit, the row wraps at 320px\n');
  write(path.join(box.project, 'b.txt'), 'b\n');
  git('add', '-A');
  git('commit', '-qm', 'FIX SECRET RATIONALE ring buffer');
  assert.equal(run(box, 'triage').code, 0);
  assert.equal(run(box, 'brief').code, 0);
  const two = fs.readFileSync(dot(box, 'review', 'brief.md'), 'utf8');
  assert.doesNotMatch(two, /SECRET RATIONALE/);
  assert.match(two, /1 commit since the last round was briefed/);
  assert.match(two, /Your seat this round: a tester paid for every bug/);
  box.cleanup();
});
