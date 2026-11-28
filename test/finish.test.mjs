import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cli, sandbox } from './helpers.mjs';
import { makeProject, PROJECT_MD, runJson } from './projects.mjs';

const finish = (box, ...args) => cli(['finish', ...args], { cwd: box.project, env: box.env });

test('a prototype cannot skip its hero merely because the browser was unavailable', () => {
  const box = sandbox();
  const run = runJson({ hero: null, matrixSkipped: 'Browser was unavailable', mustNotBreak: { kind: 'numbers', status: 'pass', summary: '12 checks passed' } });
  makeProject(box, { run, matrix: null, checkFiles: { numbers: '12 checks passed, no failures.\n' } });
  const done = finish(box);
  assert.notEqual(done.code, 0);
  assert.match(done.err, /hero is missing/);
  box.cleanup();
});

test('finish closes a valid run, writes the report and registers it once', () => {
  const box = sandbox();
  makeProject(box);
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /^Glow: ready to ship\.\n[^\n]+\n/, 'the verdict is alone on line 1, and the reason follows on line 2');
  assert.doesNotMatch(done.out, /A thing that glows/, 'the pitch is on the report page, and the chat message leaves it there');
  assert.match(done.out, /\nIt is on the report page with every finished run\. Call `100x-report` to open that page\.\n?$/);
  assert.doesNotMatch(done.out, /100x morning/, 'the owner does not say morning, so the message never tells them to');
  assert.match(done.out, /Asks: 2 of 2 closed\n/);
  const report = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8');
  assert.match(report, /^# Glow/);
  assert.match(report, /2 of 2 closed\./);
  assert.match(report, /Prestige \| delete src\/prestige/);
  assert.ok(fs.existsSync(path.join(box.project, '.100x', 'hero.png')));
  const run = JSON.parse(fs.readFileSync(path.join(box.project, '.100x', 'run.json'), 'utf8'));
  assert.ok(run.finishedAt && run.id);
  finish(box);
  const list = cli(['registry', 'list', '--json'], { env: box.env });
  assert.equal(JSON.parse(list.out).length, 1, 'finishing twice keeps one registry entry');
  box.cleanup();
});

test('a run.json from before the verdict and moment words changed still finishes, and finishes under the new words', () => {
  const box = sandbox();
  const legacy = { ...runJson(), verdict: 'wow', wow: 'The first tap lights the whole screen.' };
  delete legacy.moment;
  makeProject(box, { run: legacy });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /^Glow: ready to ship\.\n/);
  assert.match(done.out, /\nThe moment: The first tap lights the whole screen\n/);
  const run = JSON.parse(fs.readFileSync(path.join(box.project, '.100x', 'run.json'), 'utf8'));
  assert.equal(run.verdict, 'ship');
  assert.equal(run.moment, 'The first tap lights the whole screen.');
  assert.equal('wow' in run, false);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Verdict: ready to ship\./);
  box.cleanup();
});

test('registry list reads like the gallery, the date and the verdict first, and the id last for registry remove', () => {
  const box = sandbox();
  makeProject(box);
  assert.equal(finish(box).code, 0);
  const [entry] = JSON.parse(cli(['registry', 'list', '--json'], { env: box.env }).out);
  const line = cli(['registry', 'list'], { env: box.env }).out.trim();
  assert.match(line, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M +ship +Glow +(?:\/|[A-Za-z]:\\)/, line);
  assert.ok(line.endsWith(`  ${entry.id}`), 'the id is the last column');
  assert.doesNotMatch(line, /\d{4}-\d{2}-\d{2}T/, 'no ISO timestamp');
  assert.equal(cli(['registry', 'remove', line.split(/\s+/).at(-1)], { env: box.env }).out.trim(), 'removed 1 run');
  box.cleanup();
});

test('finish also writes the report as a page the owner can read, with the words escaped and the hero beside it', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ title: 'Glow <b>&</b>', moment: 'Tap <script>alert(1)</script> once' }) });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  const file = path.join(box.project, '.100x', 'REPORT.html');
  const page = fs.readFileSync(file, 'utf8');
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /<title>Glow &lt;b&gt;&amp;&lt;\/b&gt;\. 100x report<\/title>/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /Tap &lt;script&gt;alert\(1\)&lt;\/script&gt; once/);
  assert.match(page, /<img src="hero\.png"/);
  assert.match(page, /<span class="badge ship">Ready to ship<\/span>/);
  assert.match(page, /<code data-command>cd [^<]+ &amp;&amp; npm run dev<\/code>/, 'the command names the folder it runs in');
  assert.match(page, /<button type="button" data-copy="cd [^"]+ &amp;&amp; npm run dev">Copy run command<\/button><a href="http:\/\/127\.0\.0\.1:5999\/">Then open http:\/\/127\.0\.0\.1:5999\/<\/a>/);
  assert.match(page, /<ol><li>Tap once<\/li><li>Rotate the phone<\/li><\/ol>/);
  assert.match(page, /Must not break, screen sizes<\/dt><dd><span class="chip ship">Passed<\/span>0 broken across 12 viewports/);
  assert.doesNotMatch(page, /Look first/, 'a clean run has no red block');
  assert.match(page, /2 of 2 closed\./);
  assert.match(page, /<span class="chip dropped">Dropped<\/span><span>print view \(dropped: out of scope\)/);
  assert.match(page, /<b>Prestige<\/b>\. delete src\/(<wbr>)?prestige/);
  assert.match(page, /Next likely asks[\s\S]*Daily rewards/);
  fs.rmSync(file);
  const again = cli(['report'], { cwd: box.project, env: box.env });
  assert.match(again.out, /wrote .*REPORT\.md and .*REPORT\.html/);
  assert.ok(fs.existsSync(file), '100x report brings the page back');
  box.cleanup();
});

test('a project whose own file has 100x in its name is not mistaken for a run command that uses the tool', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ runCmd: 'node tools/100x-demo.mjs --serve' }) });
  fs.mkdirSync(path.join(box.project, 'tools'));
  fs.writeFileSync(path.join(box.project, 'tools', '100x-demo.mjs'), 'console.log("demo");\n');
  const check = finish(box, '--check');
  assert.equal(check.code, 0, check.err + check.out);
  assert.match(check.out, /ready to finish/);
  box.cleanup();
});

test('a report with no picture on disk says so in a plain tile instead of showing a broken one', () => {
  const box = sandbox();
  makeProject(box);
  finish(box);
  fs.rmSync(path.join(box.project, '.100x', 'hero.png'));
  cli(['report'], { cwd: box.project, env: box.env });
  const page = fs.readFileSync(path.join(box.project, '.100x', 'REPORT.html'), 'utf8');
  assert.doesNotMatch(page, /<img/);
  assert.match(page, /<figure class="hero gone"><p>The picture is not in the run folder any more\.<\/p><\/figure>/);
  box.cleanup();
});

test('a judge that is the model that built the run is named in the warning, the report, the message and the report page', () => {
  const box = sandbox();
  makeProject(box);
  cli(['config', 'set', 'builder.model', 'muse-wonder-1.0', '--global'], { cwd: box.project, env: box.env });
  const done = finish(box);
  assert.equal(done.code, 0, done.err + done.out);
  assert.match(done.out, /warn\s+the judge \(muse-wonder-1\.0\) is the same model as the builder in your settings/);
  assert.match(done.out, /Review \(muse-wonder-1\.0\): [^\n]*\nJudged by: the same model that built it\n/);
  assert.match(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Review \(muse-wonder-1\.0, the same model that built it\)/);
  const page = cli(['morning', '--all'], { env: box.env });
  assert.equal(page.code, 0, page.err + page.out);
  assert.match(fs.readFileSync(path.join(box.home, '.100x', 'morning', 'index.html'), 'utf8'), /The judge was the model that built it/);
  box.cleanup();
});

const BLOCKERS = [
  ['a missing moment', { run: runJson({ moment: '' }) }, /moment is missing/],
  ['a verdict outside the three words', { run: runJson({ verdict: 'great' }) }, /verdict must be one of/],
  ['a missing hero file', { run: runJson({ hero: '.100x/nope.png' }) }, /hero .* does not exist/],
  ['too few try-first steps', { run: runJson({ tryFirst: ['Tap once'] }) }, /tryFirst needs at least 2/],
  ['too many try-first steps', { run: runJson({ tryFirst: ['Tap once', 'Tap twice', 'Tap three times', 'Tap four times', 'Tap five times'] }) }, /tryFirst has 5 steps, 4 at most/],
  ['an unreviewed run with no reason', { run: runJson({ review: { status: 'unreviewed' } }) }, /needs review\.note/],
  ['a must-not-break check without a status', { run: runJson({ mustNotBreak: { kind: 'numbers', summary: 'x' } }) }, /the must-not-break check "numbers"\. The status must be one of pass, fail, skipped/],
  ['a verdict text the owner could not read in ten seconds', { run: runJson({ verdictWhy: 'Scored 5 of 6 (first minute 2, screenshot 2, second day 1): a frame 216 ms after tapping 25% shows the button squashed, the friends mid-hop, a ring crossing the screen and the number rolling to its answer, and 0 broken of 2149 elements over 14 states, which is why it stays a ship even though the second day only scored 1 of 2 and the audio was never heard.' }) }, /verdictWhy is 3\d\d characters, 320 at most\. The owner reads it first.*100x run set verdictWhy "<shorter>"/],
  ['a title that is a sentence', { run: runJson({ title: 'A tip splitter for a table of friends that rounds each share to the cent and shows who owes what' }) }, /title is 96 characters, 70 at most\. It is a name: it heads the card and the page[\s\S]*100x run set title "<shorter>"/],
  ['a pitch and a moment that run on', { run: runJson({ pitch: 'x '.repeat(130).trim(), moment: 'y '.repeat(130).trim() }) }, /pitch is 259 characters, 240 at most[\s\S]*moment is 259 characters, 240 at most/],
  ['a try-first step that is a paragraph', { run: runJson({ tryFirst: ['Tap once', 'Open it, then '.repeat(20)] }) }, /tryFirst step 2 \(279 characters\) is over 200\. One action a step/],
  ['a must-not-break summary that tells the whole story', { run: runJson({ mustNotBreak: { kind: 'screen-sizes', status: 'pass', summary: '0 broken. '.repeat(50) } }) }, /the must-not-break summary for screen-sizes is 499 characters, 400 at most/],
  ['a run command that runs 100x', { run: runJson({ runCmd: 'PORT=$(100x port) npm start' }) }, /runCmd runs 100x\. Write the project's own start command, the one the owner types in the project folder, for example `100x run set runCmd "npm start"`/],
  ['an ask that is still open', { projectMd: PROJECT_MD.replace('- [x] a thing', '- [ ] a thing') }, /1 of 2 asks are still open/],
  ['an ask dropped without a reason', { projectMd: PROJECT_MD.replace('(dropped: out of scope)', '(skipped)') }, /dropped without a reason/],
  ['no ask ledger at all', { projectMd: '# Demo\n\n## Brief\nx\n' }, /no "## Asks" ledger/],
];

for (const [name, setup, pattern] of BLOCKERS) {
  test(`finish refuses ${name}`, () => {
    const box = sandbox();
    makeProject(box, setup);
    const result = finish(box);
    assert.equal(result.code, 1);
    assert.match(result.err, pattern);
    assert.equal(cli(['registry', 'list', '--json'], { env: box.env }).out.trim(), '[]', 'a blocked run is not registered');
    box.cleanup();
  });
}

// A logged row becomes the start of the run, so the matrix must not look older than it. An hour ahead keeps a slow machine
// from running the test later than the margin.
const LATER = { startedAt: new Date(Date.now() + 3600000).toISOString() };
const UNREVIEWED = runJson({ review: { status: 'unreviewed', note: 'the judge model was unavailable, the start failed twice' } });

test('a set-up judge has to be tried before a run may say UNREVIEWED', () => {
  const box = sandbox();
  makeProject(box, { run: UNREVIEWED });
  const refused = finish(box);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /unreviewed, but a judge is set up \(via harness\) and no review attempt is logged/);
  assert.match(refused.err, /Nothing limits how many agents you may start for the judge/);
  box.cleanup();
});

test('an unreviewed run needs no attempt when the clock left no room for a judge', () => {
  const box = sandbox();
  makeProject(box, { run: UNREVIEWED, matrix: LATER });
  cli(['clock', 'set', '+12m'], { cwd: box.project, env: box.env });
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Review: UNREVIEWED, the judge model was unavailable/);
  const early = sandbox();
  makeProject(early, { run: UNREVIEWED, matrix: LATER });
  cli(['clock', 'set', '+3h'], { cwd: early.project, env: early.env });
  assert.match(finish(early).err, /unreviewed, but a judge is set up \(via harness\) and no review attempt is logged/);
  box.cleanup();
  early.cleanup();
});

test('an unreviewed run is not crashed by a judge the owner\'s limits refuse', () => {
  const box = sandbox();
  makeProject(box, { run: UNREVIEWED, matrix: LATER });
  const lock = cli(['config', 'set', 'helper.only', 'composer-2.5-fast', '--global'], { cwd: box.project, env: box.env });
  assert.equal(lock.code, 0, lock.err);
  assert.equal(cli(['review-call'], { cwd: box.project, env: box.env }).code, 1, 'the judge really is refused by the lock');
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Review: UNREVIEWED, the judge model was unavailable/);
  box.cleanup();
});

test('an unreviewed run is allowed when the attempt is logged, and the report says UNREVIEWED', () => {
  const box = sandbox();
  makeProject(box, { run: UNREVIEWED, matrix: LATER });
  cli(['log', 'review', 'starting the second-model review', 'stage 6'], { cwd: box.project, env: box.env });
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Review: UNREVIEWED, the judge model was unavailable/);
  box.cleanup();
});

test('an unreviewed run needs no attempt when no judge is set up or the owner turned review off', () => {
  const none = sandbox();
  makeProject(none, { run: UNREVIEWED, judge: false });
  assert.equal(finish(none).code, 0);
  none.cleanup();
  const off = sandbox();
  makeProject(off, { run: UNREVIEWED });
  cli(['config', 'set', 'review.enabled', 'false', '--global'], { cwd: off.project, env: off.env });
  assert.equal(finish(off).code, 0);
  off.cleanup();
});

const MOCKUP = runJson({ mode: 'mockup', polishPasses: 0, mustNotBreak: undefined, review: { status: 'unreviewed', note: 'mockup mode, no judges by design' } });

const MOCKUP_NOTES = 'The question. Does a tip feel quick?\nVerdict. holds.\n';

// A mockup as the mode builds it: its own short clock from the first minutes, and MOCKUP.md at the end.
function mockupProject(box, run = MOCKUP, { notes = true, clock = '+15m', loops = true } = {}) {
  makeProject(box, { run, matrix: LATER, checkFiles: {}, loops });
  if (clock) assert.equal(cli(['clock', 'set', clock], { cwd: box.project, env: box.env }).code, 0);
  if (notes) fs.writeFileSync(path.join(box.project, 'MOCKUP.md'), MOCKUP_NOTES);
}

test('a mockup finishes UNREVIEWED with no judge attempt and no must-not-break check, because it has none by design', () => {
  const box = sandbox();
  mockupProject(box);
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Review: UNREVIEWED, mockup mode, no judges by design/);
  assert.doesNotMatch(result.out, /Look first/, 'no check and no judge are not alarms for a mockup');
  assert.equal(JSON.parse(fs.readFileSync(path.join(box.project, '.100x', 'run.json'), 'utf8')).mode, 'mockup');
  assert.doesNotMatch(fs.readFileSync(path.join(box.project, '.100x', 'REPORT.md'), 'utf8'), /Look first/);
  // The morning page says it is a mockup, and does not count it among the runs a judge never looked at.
  assert.equal(cli(['morning'], { env: box.env }).code, 0);
  const gallery = fs.readFileSync(path.join(box.env.X100_HOME, 'morning', 'index.html'), 'utf8');
  assert.match(gallery, /1 prototype in the last 18 hours\. 1 mockup\./, 'the headline counts it as a mockup and as nothing else');
  assert.match(gallery, /A mockup, nobody judged it/);
  assert.doesNotMatch(gallery, /never checked by a judge/);
  box.cleanup();
});

test('a run cannot take the mockup exit once it was polished, and a mockup needs MOCKUP.md and its own short clock from the start', () => {
  const box = sandbox();
  mockupProject(box, MOCKUP, { notes: false });
  const bare = finish(box);
  assert.equal(bare.code, 1);
  assert.match(bare.err, /a mockup writes MOCKUP\.md in the project folder/);
  fs.writeFileSync(path.join(box.project, 'MOCKUP.md'), MOCKUP_NOTES);
  fs.mkdirSync(path.join(box.project, '.100x', 'loops', 'pass-1'), { recursive: true });
  const polished = finish(box);
  assert.equal(polished.code, 1);
  assert.match(polished.err, /run\.json says mode mockup, but this run has polish passes \(pass-1\)\. A mockup has none\. A run that was polished is a normal run: take the flag off with `100x run unset mode`/);
  box.cleanup();

  const claimed = sandbox();
  mockupProject(claimed, { ...MOCKUP, polishPasses: 2 }, { loops: false });
  assert.match(finish(claimed).err, /run\.json says mode mockup, but this run has polish passes \(polishPasses 2\)/);
  claimed.cleanup();

  const none = sandbox();
  mockupProject(none, MOCKUP, { clock: null });
  assert.match(finish(none).err, /a mockup keeps its own short clock, and this run has none\. A mockup starts with `100x clock set \+15m`/);
  none.cleanup();

  const long = sandbox();
  mockupProject(long, MOCKUP, { clock: '+8h' });
  assert.match(finish(long).err, /This run's clock is 480 minutes and was set 0 minutes after the run began, so the run did not start as a mockup/);
  long.cleanup();

  const late = sandbox();
  mockupProject(late);
  const file = path.join(late.project, '.100x', 'clock.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...record, setAt: new Date(Date.now() + 3600000).toISOString(), deadline: new Date(Date.now() + 4500000).toISOString() }));
  assert.match(finish(late).err, /This run's clock is 15 minutes and was set 6\d minutes after the run began/);
  late.cleanup();
});

test('a mockup is still refused when its must-not-break check has no output behind it, and a normal run is still refused without one', () => {
  const box = sandbox();
  makeProject(box, { run: { ...MOCKUP, mustNotBreak: { kind: 'numbers', status: 'pass', summary: '6 checks, 0 failing' } }, matrix: LATER, checkFiles: {} });
  assert.match(finish(box).err, /the must-not-break check "numbers"\. It says pass but there is no output to back it up/);
  makeProject(box, { run: runJson({ mustNotBreak: undefined }), matrix: LATER, checkFiles: {} });
  assert.match(finish(box).err, /No must-not-break check is recorded/);
  box.cleanup();
});

test('finish --check validates without writing anything', () => {
  const box = sandbox();
  makeProject(box);
  const ok = finish(box, '--check');
  assert.equal(ok.code, 0);
  assert.match(ok.out, /ready to finish/);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'REPORT.md')), false);
  assert.equal(fs.existsSync(path.join(box.project, '.100x', 'REPORT.html')), false);
  makeProject(box, { run: runJson({ moment: '' }) });
  const bad = finish(box, '--check');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /error moment is missing/);
  box.cleanup();
});

test('a failing must-not-break check and a broken matrix are reported as warnings, not hidden', () => {
  const box = sandbox();
  makeProject(box, {
    run: runJson({ mustNotBreak: { kind: 'numbers', status: 'fail', summary: '3 of 40 golden cases fail, interest rounds down' }, verdict: 'dud' }),
    checkFiles: { numbers: 'not ok 3 interest rounds down\nℹ pass 37\nℹ fail 3\n' },
    matrix: { broken: 2 },
  });
  const result = finish(box);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /\nLook first: [^\n]*Numbers check FAILED/, 'the failing check is in the words the owner reads first, so no warn line repeats it');
  assert.doesNotMatch(result.out, /warn\s+a must-not-break check fails/);
  assert.match(result.out, /warn\s+verdict is needs work/);
  assert.match(result.out, /warn\s+the final matrix still has 2 broken findings/);
  box.cleanup();
});

test('finish reminds you to delete a recorded watchdog', () => {
  const box = sandbox();
  makeProject(box);
  fs.writeFileSync(path.join(box.project, '.100x', 'watchdog.json'), JSON.stringify({ scheduledTaskId: 'x' }));
  assert.match(finish(box).out, /A watchdog is armed as x\. Delete that scheduled task with your app's own tool, then run `100x watchdog clear`/);
  box.cleanup();
});

test('report rebuilds from partial facts without crashing', () => {
  const box = sandbox();
  cli(['init', '--no-git'], { cwd: box.project, env: box.env });
  const result = cli(['report', '--print'], { cwd: box.project, env: box.env });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Screen sizes: not run/);
  box.cleanup();
});

test('a list edited by hand into the wrong shape is named in words by finish and report, and is not a TypeError', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ nextAsks: 'one, two', features: [null], tryFirst: { a: 1 } }) });
  const check = finish(box, '--check');
  assert.equal(check.code, 1, check.out);
  assert.match(check.out, /error nextAsks is a list\. Add one with `100x run push nextAsks "<one line>"`, or write the whole list with `100x run set nextAsks '\["first","second"\]'`\./);
  assert.match(check.out, /error tryFirst is a list\./);
  assert.match(check.out, /error features is a list of features, each with a name and a cutHint\. Add one with `100x run push features '\{"name":"Prestige","cutHint":"delete src\/prestige"\}'`\./);
  assert.doesNotMatch(`${check.out}${check.err}`, /TypeError|is not a function|Cannot read prop/);
  const report = cli(['report'], { cwd: box.project, env: box.env });
  assert.equal(report.code, 1);
  assert.match(report.err, /The report cannot be written yet\. tryFirst is a list\. .* nextAsks is a list\./);
  assert.doesNotMatch(report.err, /TypeError|is not a function|Cannot read prop/);
  assert.equal(finish(box).code, 1, 'the same words stop the real finish');
  const fixed = runJson({ nextAsks: ['one', 'two'], features: [{ name: 'Prestige', cutHint: 'delete src/prestige' }], tryFirst: ['Tap once', 'Rotate the phone'] });
  makeProject(box, { run: fixed });
  assert.equal(finish(box, '--check').code, 0);
  box.cleanup();
});

test('report words a check whose kind and status are not text, instead of failing on them', () => {
  const box = sandbox();
  makeProject(box, { run: runJson({ mustNotBreak: [{ kind: {}, status: 0, summary: 12 }] }) });
  const report = cli(['report', '--print'], { cwd: box.project, env: box.env });
  assert.equal(report.code, 0, report.err);
  assert.match(report.out, /Must not break: check unknown/);
  assert.doesNotMatch(report.out, /\[object Object\]/);
  const check = finish(box, '--check');
  assert.equal(check.code, 1);
  assert.match(check.out, /error the must-not-break check\. The kind must be one lowercase word/);
  assert.doesNotMatch(check.out, /\[object Object\]/);
  box.cleanup();
});
