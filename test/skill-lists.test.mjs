import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { MIN_DECISIVE, ALPHA } from '../lib/eval/tally.mjs';
import { signTest } from '../lib/eval/stats.mjs';
import { cli, ROOT } from './helpers.mjs';

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const skills = fs.readdirSync(path.join(ROOT, 'skills')).filter((name) => fs.existsSync(path.join(ROOT, 'skills', name, 'SKILL.md'))).sort();
const modes = skills.filter((name) => name.startsWith('100x-'));

test('every mode skill is in the README table, the router table, the router description and each prose list of the modes', () => {
  const readme = read('README.md');
  const router = read('skills', '100x', 'SKILL.md');
  const description = /^description: "(.*)"$/m.exec(router)[1];
  const design = read('docs', 'design.md');
  const installLine = read('docs', 'install.md').split('\n').find((line) => line.startsWith('- One link for each skill in `~/.agents/skills`'));
  const layoutLine = read('docs', 'contributing.md').split('\n').find((line) => line.startsWith('`skills/100x/` holds the router and the pipeline.'));
  assert.ok(installLine && layoutLine, 'the two lines that list the modes, in docs/install.md and docs/contributing.md, are still there');
  const designLine = design.split('\n').find((line) => line.startsWith('- One skill, `100x`, is the router and the pipeline.'));
  assert.ok(designLine);
  assert.ok(modes.length >= 11, `found ${modes.length} modes`);
  for (const name of modes) {
    assert.ok(readme.includes(`| \`/${name}\` |`), `${name} has no row in the README table`);
    assert.ok(router.includes(`| \`${name}\` |`), `${name} has no row in the router table`);
    assert.ok(description.includes(name), `${name} is not in the router description`);
    assert.ok(installLine.includes(`\`${name}\``), `${name} is not in the install line`);
    assert.ok(layoutLine.includes(`\`${name}\``), `${name} is not in the layout line`);
    assert.ok(designLine.includes(`\`${name}\``), `${name} is not in the design note`);
  }
});

test('the bake-off skill names every bake-off action the command has, and no action it does not have', () => {
  const skill = read('skills', '100x-bakeoff', 'SKILL.md');
  const help = cli(['eval', '--help'], {}).out;
  const real = new Set([...help.matchAll(/^100x eval bakeoff ([a-z]+) /gm)].map((m) => m[1]));
  assert.deepEqual([...real].sort(), ['gallery', 'init', 'mark', 'pairs', 'score', 'status']);
  const named = new Set([...skill.matchAll(/100x eval bakeoff ([a-z]+)/g)].map((m) => m[1]));
  assert.deepEqual([...named].sort(), [...real].sort(), 'the skill uses each action once it is told about it, and invents none');
});

test('the protocol and the skill state the same rule as the code: 6 decisive pairs, p under 0.05, 20 minutes, and 5 of 5 gives 0.0625', () => {
  const protocol = read('evals', 'PROTOCOL.md');
  const skill = read('skills', '100x-bakeoff', 'SKILL.md');
  assert.equal(MIN_DECISIVE, 6);
  assert.equal(ALPHA, 0.05);
  assert.match(protocol, /At least 6 decisive pairs\./);
  assert.match(protocol, /gives p below 0\.05/);
  assert.match(protocol, /With 5 decisive pairs even a clean sweep gives p = 0\.0625/);
  assert.equal(signTest(5, 0), 0.0625);
  assert.match(protocol, /The limit is 20 minutes by this machine's clock\./);
  assert.match(skill, /at least 6 decisive pairs, an exact sign test under 0\.05/);
  assert.match(skill, /the same 20 minutes/);
});

test('the words the project keeps out of its claims are not in the protocol, the skill, the briefs or the eval docs', () => {
  const files = [['evals', 'PROTOCOL.md'], ['evals', 'briefs.json'], ['skills', '100x-bakeoff', 'SKILL.md']];
  for (const parts of files) {
    const text = read(...parts);
    assert.doesNotMatch(text, /\bSOTA\b|state of the art|\bbeats?\b/i, `${parts.join('/')} makes a claim the data cannot back`);
    assert.doesNotMatch(text, /[\u2013\u2014]/, `${parts.join('/')} has a long dash`);
  }
});
