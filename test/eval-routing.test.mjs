import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadTriggers, scoreRouting, installedSkills } from '../lib/eval/routing.mjs';
import { median, signTest, wilson } from '../lib/eval/stats.mjs';
import { cli, ROOT, sandbox, write } from './helpers.mjs';

const close = (actual, expected, places = 4) => assert.ok(Math.abs(actual - expected) < 10 ** -places, `${actual} is not within 1e-${places} of ${expected}`);

test('the sign test is the exact two-sided binomial sum, worked by hand', () => {
  assert.equal(signTest(6, 0), 0.03125, '2 x (1/64)');
  assert.equal(signTest(0, 6), 0.03125, 'the same either way round');
  assert.equal(signTest(5, 0), 0.0625, '2 x (1/32), so a clean sweep of 5 never reaches 0.05');
  assert.equal(signTest(5, 1), 0.21875, '2 x (1 + 6) / 64');
  assert.equal(signTest(4, 1), 0.375, '2 x (1 + 5) / 32');
  assert.equal(signTest(7, 1), 0.0703125, '2 x (1 + 8) / 256');
  assert.equal(signTest(8, 0), 0.0078125, '2 x 1 / 256');
  assert.equal(signTest(9, 1), 0.021484375, '2 x (1 + 10) / 1024');
  assert.equal(signTest(10, 2), 0.03857421875, '2 x (1 + 12 + 66) / 4096');
  assert.equal(signTest(3, 3), 1, 'an even split is capped at 1');
  assert.equal(signTest(0, 0), 1, 'no decisive pair, nothing to test');
  assert.throws(() => signTest(600, 600), RangeError);
});

test('the Wilson interval matches the published values, and median handles an even count', () => {
  const [low6, high6] = wilson(6, 6);
  close(low6, 0.6097);
  assert.equal(high6, 1);
  const [low3, high3] = wilson(3, 6);
  close(low3, 0.1876);
  close(high3, 0.8124);
  const [low0, high0] = wilson(0, 6);
  assert.equal(low0, 0);
  close(high0, 0.3903);
  assert.equal(wilson(0, 0), null);
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 50]), 25);
  assert.equal(median([]), null);
});

// 20 messages across three skills and "none", with the answers a model gave. Every number below is counted from this table by hand.
//   skill-a expected 5  answered 6  right 3  precision 3/6 = 0.5     recall 3/5 = 0.6
//   skill-b expected 5  answered 5  right 4  precision 4/5 = 0.8     recall 4/5 = 0.8
//   skill-c expected 4  answered 3  right 3  precision 3/3 = 1       recall 3/4 = 0.75
//   none    expected 6  answered 6  right 4  precision 4/6           recall 4/6
//   14 of 20 right, accuracy 0.7
const SKILLS = ['skill-a', 'skill-b', 'skill-c'].map((name) => ({ name, description: `${name} does its job` }));
const TABLE = [
  ['skill-a', 'skill-a'], ['skill-a', 'skill-a'], ['skill-a', 'skill-a'], ['skill-a', 'skill-b'], ['skill-a', null],
  ['skill-b', 'skill-b'], ['skill-b', 'skill-b'], ['skill-b', 'skill-a'], ['skill-b', 'skill-b'], ['skill-b', 'skill-b'],
  ['skill-c', 'skill-c'], ['skill-c', 'skill-c'], ['skill-c', 'none'], ['skill-c', 'skill-c'],
  [null, 'none'], [null, 'none'], [null, 'skill-a'], [null, 'none'], [null, 'skill-a'], [null, 'none'],
];
// A null answer in the table means "none" for the expected side. Here the second column is what the model said.
const prompts = TABLE.map(([expect], index) => ({ id: `p-${index + 1}`, set: 'tune', text: `message ${index + 1}`, expect }));
const answers = Object.fromEntries(TABLE.map(([, said], index) => [`p-${index + 1}`, said === null ? 'none' : said]));

test('accuracy, precision and recall for a hand-worked 20 message answer file, to the digit', () => {
  const result = scoreRouting({ distractors: [], prompts }, answers, { set: 'tune', skills: SKILLS });
  assert.equal(result.prompts, 20);
  assert.equal(result.correct, 14);
  assert.equal(result.accuracy, 0.7);
  const a = result.classes['skill-a'];
  assert.deepEqual([a.expected, a.answered, a.tp, a.fp, a.fn, a.precision, a.recall], [5, 6, 3, 3, 2, 0.5, 0.6]);
  const b = result.classes['skill-b'];
  assert.deepEqual([b.expected, b.answered, b.tp, b.fp, b.fn, b.precision, b.recall], [5, 5, 4, 1, 1, 0.8, 0.8]);
  const c = result.classes['skill-c'];
  assert.deepEqual([c.expected, c.answered, c.tp, c.fp, c.fn, c.precision, c.recall], [4, 3, 3, 0, 1, 1, 0.75]);
  const none = result.classes.none;
  assert.deepEqual([none.expected, none.answered, none.tp, none.fp, none.fn], [6, 6, 4, 2, 2]);
  assert.equal(none.precision, 4 / 6);
  assert.equal(none.recall, 4 / 6);
  assert.deepEqual(result.wrong.map((w) => w.id), ['p-4', 'p-5', 'p-8', 'p-13', 'p-17', 'p-19']);
  assert.deepEqual(result.wrong.find((w) => w.id === 'p-4'), { id: 'p-4', text: 'message 4', expected: 'skill-a', answered: 'skill-b' });
});

test('an unanswered message, a name that is not listed and a missing answer all count as wrong, and precision is empty for a skill never named', () => {
  const small = [{ id: 'q-1', set: 'tune', text: 'one', expect: 'skill-a' }, { id: 'q-2', set: 'tune', text: 'two', expect: 'skill-b' }, { id: 'q-3', set: 'tune', text: 'three', expect: null }];
  const result = scoreRouting({ distractors: [], prompts: small }, { 'q-1': 'skill-a', 'q-2': 'invented-skill' }, { skills: SKILLS });
  assert.equal(result.correct, 1);
  assert.equal(result.unanswered, 1);
  assert.deepEqual(result.wrong.map((w) => [w.id, w.answered]), [['q-2', 'invented-skill'], ['q-3', null]]);
  assert.equal(result.classes['skill-b'].precision, null, 'skill-b was never named, so there is no precision to report');
  assert.equal(result.classes['skill-b'].recall, 0);
});

test('stage writes the messages and the list without answers, the distractors are not marked, and score reads the answers back', () => {
  const box = sandbox();
  const out = path.join(box.dir, 'staged');
  const staged = cli(['eval', 'triggers', 'stage', out, '--set', 'tune'], { cwd: box.project, env: box.env });
  assert.equal(staged.code, 0, staged.err);
  assert.deepEqual(fs.readdirSync(out).sort(), ['ask.md', 'prompts.json', 'skills.json']);
  const messages = JSON.parse(fs.readFileSync(path.join(out, 'prompts.json'), 'utf8'));
  const skills = JSON.parse(fs.readFileSync(path.join(out, 'skills.json'), 'utf8'));
  assert.ok(messages.length >= 90);
  assert.deepEqual(Object.keys(messages[0]).sort(), ['id', 'text'], 'a message carries no answer');
  assert.deepEqual(Object.keys(skills[0]).sort(), ['description', 'name'], 'nothing marks a distractor');
  assert.equal(skills.length, installedSkills().length + 8);
  assert.deepEqual(skills.map((s) => s.name), [...skills.map((s) => s.name)].sort(), 'one alphabetical list');
  // The example line holds two real message ids, which carry their set's name and are in prompts.json anyway. Nothing else in ask.md names an answer or a set.
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'ask.md'), 'utf8').replace(/^\{ "[^"]+": "some-skill".*\}$/m, ''), /expect|near|distractor|tune|holdout/i);

  const all = loadTriggers();
  const truth = Object.fromEntries(all.prompts.filter((p) => p.set === 'tune').map((p) => [p.id, p.expect ?? 'none']));
  write(path.join(out, 'answers.json'), JSON.stringify(truth));
  const perfect = cli(['eval', 'triggers', 'score', path.join(out, 'answers.json'), '--min', '1'], { cwd: box.project, env: box.env });
  assert.equal(perfect.code, 0, perfect.out);
  assert.match(perfect.out, /Accuracy 1\.000 against --min 1\. Meets it\./);
  write(path.join(out, 'answers-bad.json'), JSON.stringify({ ...truth, 'tune-001': 'none' }));
  const worse = cli(['eval', 'triggers', 'score', path.join(out, 'answers-bad.json'), '--min', '1', '--json'], { cwd: box.project, env: box.env });
  assert.equal(worse.code, 1, 'under --min exits 1');
  assert.equal(JSON.parse(worse.out).wrong.length, 1);
  box.cleanup();
});

test('the holdout is written down every time it is scored, and a second look says it is spent', () => {
  const box = sandbox();
  const truth = Object.fromEntries(loadTriggers().prompts.filter((p) => p.set === 'holdout').map((p) => [p.id, p.expect ?? 'none']));
  write(path.join(box.dir, 'answers.json'), JSON.stringify(truth));
  const score = () => cli(['eval', 'triggers', 'score', path.join(box.dir, 'answers.json'), '--set', 'holdout'], { cwd: box.project, env: box.env });
  assert.match(score().out, /This is the first look at the holdout\./);
  assert.match(score().out, /This is look 2 at the holdout\. It is spent, and a number from it is a tuned number\./);
  const ledger = fs.readFileSync(path.join(box.env.X100_HOME, 'evals', 'holdout-looks.tsv'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 2);
  const tune = cli(['eval', 'triggers', 'score', path.join(box.dir, 'answers.json'), '--set', 'tune'], { cwd: box.project, env: box.env });
  assert.doesNotMatch(tune.out, /holdout/i);
  assert.equal(fs.readFileSync(path.join(box.env.X100_HOME, 'evals', 'holdout-looks.tsv'), 'utf8').trim().split('\n').length, 2, 'a tune score is not a look');
  const everything = Object.fromEntries(loadTriggers().prompts.map((p) => [p.id, p.expect ?? 'none']));
  write(path.join(box.dir, 'everything.json'), JSON.stringify(everything));
  const all = cli(['eval', 'triggers', 'score', path.join(box.dir, 'everything.json'), '--set', 'all'], { cwd: box.project, env: box.env });
  assert.match(all.out, /This is look 3 at the holdout\./, 'the all set holds the holdout messages, so scoring it is a look at them');
  assert.equal(fs.readFileSync(path.join(box.env.X100_HOME, 'evals', 'holdout-looks.tsv'), 'utf8').trim().split('\n').length, 3);
  box.cleanup();
});

test('a saved run works the same numbers out again from the file alone, records no look, and does not move when the prompts change', () => {
  const box = sandbox();
  const triggersFile = path.join(box.dir, 'triggers.json');
  write(triggersFile, JSON.stringify({ distractors: SKILLS, prompts }));
  write(path.join(box.dir, 'answers.json'), JSON.stringify(answers));
  const saved = cli(['eval', 'triggers', 'score', path.join(box.dir, 'answers.json'), '--file', triggersFile, '--save', path.join(box.dir, 'run.json'), '--model', 'a stand-in'], { cwd: box.project, env: box.env });
  assert.equal(saved.code, 0, saved.err);
  const headline = saved.out.split('\n')[0];
  assert.match(headline, /^Routing, tune set\. 14 of 20 right, accuracy 0\.700\. Descriptions [0-9a-f]{12} \(a hash of the descriptions scored\)\.$/);
  const run = JSON.parse(fs.readFileSync(path.join(box.dir, 'run.json'), 'utf8'));
  assert.deepEqual([run.version, run.set, run.answerer, run.prompts.length, Object.keys(run.answers).length], [1, 'tune', 'a stand-in', 20, 20]);
  assert.equal(run.skills.length, installedSkills().length + 3, 'the list the model read, the skills and the distractors together');
  assert.deepEqual(Object.keys(run.prompts[0]).sort(), ['expect', 'id', 'text'], 'a message and the answer it needed');

  write(triggersFile, JSON.stringify({ distractors: SKILLS, prompts: prompts.map((prompt) => ({ ...prompt, expect: 'skill-c' })) }));
  fs.rmSync(path.join(box.dir, 'answers.json'));
  const replay = cli(['eval', 'triggers', 'score', '--bundle', path.join(box.dir, 'run.json')], { cwd: box.project, env: box.env });
  assert.equal(replay.code, 0, replay.err);
  assert.equal(replay.out.split('\n')[0], headline, 'the numbers do not move when the prompts file does');
  assert.match(replay.out, /Worked out again from .*run\.json\. No look at the holdout was recorded\./);
  const asJson = JSON.parse(cli(['eval', 'triggers', 'score', '--bundle', path.join(box.dir, 'run.json'), '--json'], { cwd: box.project, env: box.env }).out);
  assert.equal(asJson.correct, 14);
  assert.equal(asJson.classes['skill-a'].precision, 0.5);

  const holdout = path.join(box.dir, 'holdout.json');
  write(holdout, JSON.stringify({ distractors: SKILLS, prompts: prompts.map((prompt) => ({ ...prompt, set: 'holdout' })) }));
  write(path.join(box.dir, 'answers.json'), JSON.stringify(answers));
  const first = cli(['eval', 'triggers', 'score', path.join(box.dir, 'answers.json'), '--file', holdout, '--set', 'holdout', '--save', path.join(box.dir, 'holdout-run.json')], { cwd: box.project, env: box.env });
  assert.match(first.out, /This is the first look at the holdout\./);
  const again = cli(['eval', 'triggers', 'score', '--bundle', path.join(box.dir, 'holdout-run.json')], { cwd: box.project, env: box.env });
  assert.match(again.out, /^Routing, holdout set\. 14 of 20 right/);
  assert.doesNotMatch(again.out, /first look|look 2/, 'a replay is not a look');
  assert.equal(fs.readFileSync(path.join(box.env.X100_HOME, 'evals', 'holdout-looks.tsv'), 'utf8').trim().split('\n').length, 1);

  write(path.join(box.dir, 'old.json'), JSON.stringify({ ...run, version: 2 }));
  const wrong = cli(['eval', 'triggers', 'score', '--bundle', path.join(box.dir, 'old.json')], { cwd: box.project, env: box.env });
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /is not a saved routing run/);
  write(path.join(box.dir, 'torn.json'), JSON.stringify({ ...run, prompts: [{ id: 'p-1', text: 7, expect: null }] }));
  assert.match(cli(['eval', 'triggers', 'score', '--bundle', path.join(box.dir, 'torn.json')], { cwd: box.project, env: box.env }).err, /holds a message without an id, a text or an expected skill/);
  const both = cli(['eval', 'triggers', 'score', path.join(box.dir, 'answers.json'), '--bundle', path.join(box.dir, 'run.json')], { cwd: box.project, env: box.env });
  assert.equal(both.code, 1);
  assert.match(both.err, /--bundle works a saved run out again/);
  box.cleanup();
});

test('an answers file with no answer for the holdout set spends no look, and an answer that is not a string is refused', () => {
  const box = sandbox();
  const prompts = loadTriggers().prompts;
  const ledger = path.join(box.env.X100_HOME, 'evals', 'holdout-looks.tsv');
  write(path.join(box.dir, 'tune.json'), JSON.stringify(Object.fromEntries(prompts.filter((p) => p.set === 'tune').map((p) => [p.id, p.expect ?? 'none']))));
  const wrong = cli(['eval', 'triggers', 'score', path.join(box.dir, 'tune.json'), '--set', 'holdout'], { cwd: box.project, env: box.env });
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /None of the \d+ messages in the holdout set has an answer in .*tune\.json\. Check that the file answers the holdout set\. No look at the holdout was recorded\./);
  assert.equal(fs.existsSync(ledger), false, 'a file for the wrong set is not a look');

  const [first] = prompts.filter((p) => p.set === 'holdout');
  write(path.join(box.dir, 'one.json'), JSON.stringify({ [first.id]: first.expect ?? 'none' }));
  const partial = cli(['eval', 'triggers', 'score', path.join(box.dir, 'one.json'), '--set', 'holdout'], { cwd: box.project, env: box.env });
  assert.equal(partial.code, 0, partial.err);
  assert.match(partial.out, /This is the first look at the holdout\./, 'one answer for the set is a look');
  assert.equal(fs.readFileSync(ledger, 'utf8').trim().split('\n').length, 1);

  for (const odd of [1, ['a'], { skill: 'x' }, true]) {
    write(path.join(box.dir, 'odd.json'), JSON.stringify({ [first.id]: odd }));
    const refused = cli(['eval', 'triggers', 'score', path.join(box.dir, 'odd.json'), '--set', 'holdout'], { cwd: box.project, env: box.env });
    assert.equal(refused.code, 1, JSON.stringify(odd));
    assert.match(refused.err, new RegExp(`The answer for ${first.id} must be a skill name or "none" as a string\\.`));
  }
  assert.equal(fs.readFileSync(ledger, 'utf8').trim().split('\n').length, 1, 'a refused file is not a look either');
  box.cleanup();
});

test('the historical routing set covers its listed skills and explicitly names untested imports', () => {
  const data = loadTriggers();
  const skills = installedSkills().map((s) => s.name);
  assert.equal(skills.length, fs.readdirSync(path.join(ROOT, 'skills')).filter((n) => fs.existsSync(path.join(ROOT, 'skills', n, 'SKILL.md'))).length);
  const inSet = (set) => data.prompts.filter((p) => p.set === set);
  assert.deepEqual([...data.excluded_skills].sort(), ['execute-scope', 'new-scope', 'project-mapper', 'qa-scope']);
  for (const name of data.excluded_skills) assert.ok(skills.includes(name));
  for (const skill of skills.filter((name) => !data.excluded_skills.includes(name))) {
    const should = (set) => inSet(set).filter((p) => p.expect === skill && p.near === undefined).length;
    const near = (set) => inSet(set).filter((p) => p.near === skill && p.expect !== skill).length;
    assert.ok(should('tune') >= 3, `${skill} has ${should('tune')} tune prompts that should call it, 3 are needed`);
    assert.ok(near('tune') >= 2, `${skill} has ${near('tune')} tune near-misses, 2 are needed`);
    assert.ok(should('holdout') >= 2, `${skill} has ${should('holdout')} holdout prompts that should call it, 2 are needed`);
    assert.ok(near('holdout') >= 1, `${skill} has ${near('holdout')} holdout near-misses, 1 is needed`);
  }
  assert.equal(data.distractors.length, 8);
  for (const distractor of data.distractors) {
    assert.ok(inSet('tune').filter((p) => p.expect === distractor.name).length >= 2, `${distractor.name} needs tune prompts`);
    assert.ok(inSet('holdout').filter((p) => p.expect === distractor.name).length >= 1, `${distractor.name} needs a holdout prompt`);
  }
  assert.ok(inSet('tune').filter((p) => p.expect === null && p.near === undefined).length >= 6, 'prompts that need no skill at all');
  assert.ok(inSet('holdout').filter((p) => p.expect === null && p.near === undefined).length >= 3);
});

test('every holdout prompt names who wrote it, and it is not the builder or a model that saw the descriptions', () => {
  const holdout = loadTriggers().prompts.filter((p) => p.set === 'holdout');
  assert.ok(holdout.length >= 60);
  for (const prompt of holdout) {
    assert.match(prompt.writer ?? '', /saw one line of purpose per skill and no description/, `${prompt.id} has no writer line`);
    assert.doesNotMatch(prompt.writer, /claude|sonnet|opus|builder/i);
  }
  for (const prompt of loadTriggers().prompts.filter((p) => p.set === 'tune')) assert.equal(prompt.writer, undefined, 'tune prompts were written by the builder, and say nothing else');
});

test('a prompts file with a wrong skill name, a repeated id or a bad set is refused with the prompt named', () => {
  const box = sandbox();
  const file = path.join(box.dir, 'bad.json');
  const bad = (prompt) => {
    write(file, JSON.stringify({ distractors: [], prompts: [{ id: 'x-1', set: 'tune', text: 'hello', expect: null, ...prompt }] }));
    return cli(['eval', 'triggers', 'stage', path.join(box.dir, 'out'), '--file', file], { cwd: box.project, env: box.env });
  };
  assert.match(bad({ expect: 'no-such-skill' }).err, /prompt x-1: expect "no-such-skill" is not a skill or a distractor/);
  assert.match(bad({ set: 'practice' }).err, /prompt x-1: set is "practice", it must be tune or holdout/);
  assert.match(bad({ near: 'no-such-skill' }).err, /prompt x-1: near "no-such-skill" is not a skill in skills\//);
  assert.match(bad({ text: '  ' }).err, /prompt x-1: the text is empty/);
  write(file, JSON.stringify({ distractors: [], prompts: [{ id: 'x-1', set: 'tune', text: 'a', expect: null }, { id: 'x-1', set: 'tune', text: 'b', expect: null }] }));
  assert.match(cli(['eval', 'triggers', 'stage', path.join(box.dir, 'out'), '--file', file], { cwd: box.project, env: box.env }).err, /the id is missing or repeated/);
  box.cleanup();
});

test('a saved run with no message, an answers list with an entry that is not an answer, a repeated distractor and a stage target that is a file are refused in plain words', () => {
  const box = sandbox();
  const score = (...args) => cli(['eval', 'triggers', 'score', ...args], { cwd: box.project, env: box.env });
  const empty = path.join(box.dir, 'empty.json');
  write(empty, JSON.stringify({ version: 1, set: 'holdout', skills: [], prompts: [], answers: {} }));
  const none = score('--bundle', empty);
  assert.equal(none.code, 1, 'an accuracy over no messages is no number, so it is not exit 0');
  assert.match(none.err, /The holdout set holds no messages, so there is nothing to stage or score\./);
  const withMin = score('--bundle', empty, '--min', '0.5');
  assert.equal(withMin.code, 1);
  assert.doesNotMatch(withMin.err, /toFixed|Cannot read/, 'no raw crash either');

  const nulls = path.join(box.dir, 'nulls.json');
  write(nulls, '[null]');
  const entry = score(nulls);
  assert.equal(entry.code, 1);
  assert.match(entry.err, /nulls\.json entry 1 is not \{ "id": "<message id>", "skill": "<skill name or none>" \}\. Got null\./);
  write(nulls, JSON.stringify([{ id: 'p-001', skill: 'x' }, { skill: 'x' }]));
  assert.match(score(nulls).err, /entry 2 is not/);

  const file = path.join(box.dir, 'dup.json');
  const real = installedSkills()[0].name;
  write(file, JSON.stringify({ distractors: [{ name: real, description: 'same name as a real skill' }], prompts: [{ id: 'x-1', set: 'tune', text: 'hello', expect: null }] }));
  const stage = (target = path.join(box.dir, 'out')) => cli(['eval', 'triggers', 'stage', target, '--file', file], { cwd: box.project, env: box.env });
  assert.match(stage().err, new RegExp(`the distractor "${real}" has the name of a skill in skills/, so the list a model chooses from would hold it twice`));
  write(file, JSON.stringify({ distractors: [{ name: 'twin', description: 'a' }, { name: 'twin', description: 'b' }], prompts: [{ id: 'x-1', set: 'tune', text: 'hello', expect: null }] }));
  assert.match(stage().err, /the distractor "twin" has the name of another distractor/);
  write(file, JSON.stringify({ distractors: [{ description: 'no name' }], prompts: [{ id: 'x-1', set: 'tune', text: 'hello', expect: null }] }));
  assert.match(stage().err, /a distractor has no name/);

  write(file, JSON.stringify({ distractors: [], prompts: [{ id: 'x-1', set: 'tune', text: 'hello', expect: null }] }));
  const target = path.join(box.dir, 'afile');
  write(target, 'x');
  assert.match(stage(target).err, /afile is a file, not a folder\. Name a folder to stage into\./);
  assert.equal(stage().code, 0, 'a clean file and a fresh folder still stage');
  box.cleanup();
});
