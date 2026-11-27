import fs from 'node:fs';
import path from 'node:path';
import { cli, write } from './helpers.mjs';
import { PROMPT_MARKER } from '../lib/prompt.mjs';
import { hashCovers, writeLedger } from '../lib/verify.mjs';
import { sealFile } from '../lib/seal.mjs';
import { gradientPng } from './png.mjs';

export const PNG = gradientPng();

export const matrixJson = ({ broken = 0, weak = 2, startedAt = new Date().toISOString(), matrix = 'all-rotate', viewports = 15, target = 'http://localhost:5173' } = {}) => ({
  tool: '100x shots',
  target,
  matrix,
  startedAt,
  viewports: Array.from({ length: viewports }, (_, index) => ({ name: `viewport-${index}` })),
  summary: { totals: { broken, weak, info: 0 }, byCheck: {}, states: 3, examined: 212 },
});

// What 100x shots does to the files it writes, for a fixture. The key lives in the sandbox home, as it does for the CLI.
export function seal(box, file) {
  const before = process.env.X100_HOME;
  process.env.X100_HOME = box.env.X100_HOME;
  try {
    sealFile(file);
  } finally {
    if (before === undefined) delete process.env.X100_HOME;
    else process.env.X100_HOME = before;
  }
}

export const CHECK_OUTPUT = 'ok 12 golden cases\nok 4 property tests\n0 broken of 212 elements across 15 viewports\n';

export const PROJECT_MD = `# Demo

## Brief
Make a thing that glows.

## Asks
- [x] a thing that glows (evidence: shots/final)
- [~] print view (dropped: out of scope)

## Moment
It glows.
`;

// A small finished prompt, the way the prompt step leaves project.md: every section written, and the asks closed the way `100x finish` wants them.
// The fourth ask was dropped, so it does not count toward the three the check wants.
export const PROMPT_MD = `# Demo

## Brief
Make a thing that glows.

## Goal
Make a thing that glows and shows its total, on one screen, with no accounts and no sound.

## Read first
- README.md, how the glow is named.

## Rules
- Glow, not flicker. Stop at 60 frames.
- Honest total, not a flattering one. Stop at a reload.
- One screen, not three. Stop at 390 wide.

## Riskiest unknown
The glow does not hold attention. Does it hold for 60 seconds? If it does not, the idea is cut.

## Asks
- [x] 1. a thing that glows (evidence: shots/final)
- [x] 2. its total shows (evidence: \`npm test\`, 3 passing)
- [x] 3. one command runs it (evidence: \`npm start\`, README line 3)
- [~] 4. print view (dropped: out of scope)

## Scope
In: one screen at 390 wide. Out: accounts and sound.

## Test material
none: no outside files are needed

## Do not
- Do not play sound.

## Assumptions
- Phone first means a web page, because the brief names no store.

## Must not break
The glow stays on after a reload, and the total never goes down.

## Properties
- State: the glow is on or off, and the total is a whole number of cents.
- Transitions: tap turns the glow on, reload keeps it, reset turns it off.
- Invariants: the total never goes down.

## Moment
The first tap lights the whole screen.

## Judge focus
- Does it glow in the first second?
- Is the total right after a reload?
`;

export function runJson(overrides = {}) {
  return {
    title: 'Glow',
    pitch: 'A thing that glows.',
    verdict: 'ship',
    verdictWhy: 'The glow loop held attention for 60 seconds in the core stage.',
    moment: 'The first tap lights the whole screen.',
    url: 'http://127.0.0.1:5999/',
    runCmd: 'npm run dev',
    hero: '.100x/shots/final/hero-src.png',
    tryFirst: ['Tap once', 'Rotate the phone'],
    mustNotBreak: { kind: 'screen-sizes', status: 'pass', summary: '0 broken across 12 viewports' },
    review: { status: 'reviewed', model: 'muse-wonder-1.0', flags: 4, fixed: 3 },
    polishPasses: 3,
    features: [{ name: 'Prestige', cutHint: 'delete src/prestige and its import' }],
    nextAsks: ['Daily rewards'],
    ...overrides,
  };
}

export const FINDINGS = `# Findings

## F1 [major] Upgrade button clipped at 320px
Where: 320x568, shop
Evidence: shots/review/phone-320 screenshot
Fix: let the row wrap

## F2 [minor] Hint text is dim
Where: shop
Evidence: audit contrast 3.1:1
Fix: darken the token

## What is good
- The glow loop

## Verdict
Ready to ship: yes
Keep going. Fix the clipped button. Cut nothing.
`;

export const TRIAGE = `F1 accept. fixed in a1b2c3d, the row wraps at 320px
F2 reject. intentional, the hint is decorative and the real label passes AA at 4.6:1
`;

export function makeProject(box, { run = runJson(), projectMd = PROJECT_MD, root = box.project, findings = FINDINGS, triage = TRIAGE, matrix = {}, checkFiles = { 'screen-sizes': CHECK_OUTPUT }, hero = PNG, judge = true, rounds = 1, sealed = true, loops = true, reviewRow = true, polished = Number.isInteger(run.polishPasses) ? run.polishPasses : 3, prompted = false, ledger = true } = {}) {
  cli(['init', '--no-git'], { cwd: root, env: box.env });
  // Property checks are on by default, so a finishable run has a ledger. The fixture has nothing to state, and says so in a waiver.
  if (ledger) {
    write(path.join(root, 'fixture'), 'Static fixture text.\n');
    writeLedger(root, [{ id: 'waived-fixture', kind: 'waived', property: 'the fixture has no logic to state', covers: 'fixture', covers_hash: hashCovers(root, ['fixture']).hash, status: 'waived' }]);
  }
  // The run command the fixture names has to be one this folder can start.
  const manifest = path.join(root, 'package.json');
  if (/^(?:\w+=\S+\s+)*(?:npm|pnpm|yarn|bun)\s/.test(run.runCmd ?? '') && !fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ scripts: { dev: 'vite', start: 'node server.js' } }));
  // A reviewed run logged its judge. This row is the run start the matrix has to be newer than, so it comes first.
  if (reviewRow && run.review?.status === 'reviewed') cli(['log', 'review', 'judge started', 'stage 6', 'the fixture'], { cwd: root, env: box.env });
  cli(['config', 'set', 'review.rounds', String(rounds), '--global'], { cwd: root, env: box.env });
  // A run that polished fewer times than the default is a run whose owner asked for fewer. `polished` is what the owner asked for.
  if (polished !== 3) cli(['config', 'set', 'polish.passes', String(polished), '--global'], { cwd: root, env: box.env });
  if (judge) cli(['config', 'role', 'review', '--provider', 'cursor', '--model', 'muse-wonder-1.0', '--option', 'reasoning_effort=max', '--option', 'contextWindow=300k', '--global'], { cwd: root, env: box.env });
  fs.writeFileSync(path.join(root, '.100x', 'project.md'), projectMd);
  // The fixture's project.md is from before the prompt step unless it says otherwise, so it has no marker file. `prompted: true` keeps it.
  if (!prompted) fs.rmSync(path.join(root, '.100x', PROMPT_MARKER), { force: true });
  for (const [name, text] of [['findings.md', findings], ['triage.md', triage]]) {
    const file = path.join(root, '.100x', 'review', name);
    if (text === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, text);
  }
  write(path.join(root, '.100x', 'shots', 'final', 'hero-src.png'), hero);
  if (matrix) {
    const file = path.join(root, '.100x', 'shots', 'final', 'matrix.json');
    write(file, JSON.stringify(matrixJson(matrix)));
    if (sealed) seal(box, file);
  }
  // Every polish pass the run claims has left its judge's loop behind.
  for (let pass = 1; loops && pass <= (Number.isInteger(run.polishPasses) ? run.polishPasses : 0); pass += 1) {
    const loop = path.join(root, '.100x', 'loops', `pass-${pass}`);
    write(path.join(loop, 'ask.md'), 'Is the pass better?\n');
    write(path.join(loop, 'judge.md'), 'Judged by: looking at the screenshots\nDrifting: no\nBetter: yes\n');
    write(path.join(loop, 'answers.md'), 'Answered each finding.\n');
    // A project with a screen shot the pass as well.
    if (matrix) write(path.join(root, '.100x', 'shots', `pass-${pass}`, 'texts.txt'), 'a line the page showed\n');
  }
  for (const [kind, text] of Object.entries(checkFiles)) write(path.join(root, '.100x', 'must-not-break', `${kind}.txt`), text);
  fs.writeFileSync(path.join(root, '.100x', 'run.json'), JSON.stringify(run, null, 2));
  return root;
}
