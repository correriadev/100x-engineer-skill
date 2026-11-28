import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { runProgram } from '../lib/proc.mjs';
import { BASH, cli, noFileLinks, ROOT, sandbox, symlink, write } from './helpers.mjs';

const WINDOWS = process.platform === 'win32';

// Every skill folder of this repository: 100x and each of its modes. The install has to link all of them, or a mode is not there to call.
const SKILLS = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', d.name, 'SKILL.md'))).map((d) => d.name).sort();
const MODES_LINE = `The other modes are skills of their own, called the same way: ${SKILLS.filter((name) => name.startsWith('100x-')).map((name) => `\`${name}\``).join(', ')}\\.`;

function layout(box) {
  return {
    skills: path.join(box.home, '.agents', 'skills'),
    global: path.join(box.home, '.100x'),
    bin: path.join(box.home, '.local', 'bin'),
  };
}

function fakeCheckout(box, name) {
  const dir = path.join(box.dir, `checkouts`, name);
  write(path.join(dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when testing.\n---\n`);
  return dir;
}

const install = (box, ...args) => cli(['install', '--no-unslop', ...args], { env: box.env });
// The output names the sandbox folder, whose name ends in random letters. A check that a word is absent must not meet the word inside them.
const apart = (out) => out.replace(/100x-test-\w+/g, '100x-test');
const entries = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

test('the closing line names the apps a default install does not reach, and the command that reaches them', () => {
  const box = sandbox();
  fs.mkdirSync(path.join(box.home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(box.home, '.config', 'opencode'), { recursive: true });
  const plain = install(box);
  assert.equal(plain.code, 0, plain.out + plain.err);
  assert.match(plain.out, /Installed\. Call the 100x skill with a brief in a new thread of your agent app\.\n/);
  assert.match(plain.out, new RegExp(`\\n${MODES_LINE}\\n`), 'the ending names every mode skill that was linked');
  assert.ok(SKILLS.length >= 9 && SKILLS.includes('100x-status'), 'the repo has the router and each mode as a skill');
  assert.match(plain.out, /Claude Code and OpenCode are on this machine and read their own skills folder, not ~\/\.agents\/skills\. Run `100x install --also claude,opencode` to link the skills there too\./);
  const linked = install(box, '--also', 'claude');
  assert.match(linked.out, /Installed\. Call the 100x skill with a brief in a new thread\. `\/100x` in Claude Code\.\n/);
  assert.match(linked.out, /OpenCode is on this machine and reads its own skills folder[^\n]*--also opencode`/);
  assert.doesNotMatch(linked.out, /Claude Code (and|is)/ , 'a linked app is not listed as missing');
  const alone = sandbox();
  const bare = install(alone).out;
  assert.doesNotMatch(bare, /is on this machine|are on this machine/, 'no app folder, nothing to say about one');
  assert.match(bare, new RegExp(`Installed\\. Call the 100x skill with a brief in a new thread of your agent app\\.\\n${MODES_LINE}\\nNo agent app was found here\\.`));
  assert.match(bare, /No agent app was found here\. If yours does not read ~\/\.agents\/skills, run `100x install --also claude,codex,opencode,cursor` to link the skills into its folder\./);
  const cursor = sandbox();
  const named = install(cursor, '--also', 'cursor').out;
  assert.match(named, /Installed\. Call the 100x skill with a brief in a new thread\. `\/100x` in Cursor\.\n/);
  assert.doesNotMatch(named, /No agent app was found/);
  cursor.cleanup();
  alone.cleanup();
  box.cleanup();
});

test('a fresh install links every skill, the CLI and the PATH entry, and the linked CLI runs', () => {
  const box = sandbox();
  const where = layout(box);
  const result = install(box);
  assert.equal(result.code, 0, result.out + result.err);
  for (const name of SKILLS) assert.equal(fs.realpathSync(path.join(where.skills, name)), fs.realpathSync(path.join(ROOT, 'skills', name)));
  // Windows runs a program by its file name, so the CLI is a pair of launchers there, 100x.cmd and a script named 100x for Git Bash.
  if (WINDOWS) {
    for (const dir of [where.bin, path.join(where.global, 'bin')]) {
      assert.match(fs.readFileSync(path.join(dir, '100x.cmd'), 'utf8'), /^@echo off\r\nnode ".*bin\\100x\.mjs" %\*\r\n$/);
      assert.match(fs.readFileSync(path.join(dir, '100x'), 'utf8'), /^#!\/bin\/sh\nexec node ".*\/bin\/100x\.mjs" "\$@"\n$/);
    }
  } else assert.equal(fs.realpathSync(path.join(where.bin, '100x')), fs.realpathSync(path.join(ROOT, 'bin', '100x.mjs')));
  assert.equal(fs.readFileSync(path.join(where.global, 'repo'), 'utf8').trim(), fs.realpathSync.native(ROOT));
  assert.equal(fs.readFileSync(path.join(where.global, 'config.json'), 'utf8').trim(), '{}');
  assert.match(fs.readFileSync(path.join(where.global, 'profile.md'), 'utf8'), /Stage 0 reads it/);
  const version = runProgram(path.join(where.bin, WINDOWS ? '100x.cmd' : '100x'), ['version'], { encoding: 'utf8', env: { ...process.env, ...box.env } });
  assert.equal(version.status, 0, version.stderr);
  assert.ok(version.stdout.trim().startsWith(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version), 'the linked CLI prints the package number first, then the commit it is at');
  box.cleanup();
});

test('running it again changes nothing and says so', () => {
  const box = sandbox();
  const where = layout(box);
  install(box);
  const before = JSON.parse(fs.readFileSync(path.join(where.global, 'install.json'), 'utf8'));
  const again = cli(['install', '--no-unslop', '--json'], { env: box.env });
  assert.equal(again.code, 0, again.err);
  const events = JSON.parse(again.out).events.filter((e) => e.kind !== 'path');
  assert.ok(events.length > 0);
  assert.deepEqual([...new Set(events.map((e) => e.status))], ['unchanged']);
  const after = JSON.parse(fs.readFileSync(path.join(where.global, 'install.json'), 'utf8'));
  assert.deepEqual(after.links, before.links);
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(after.dirs, before.dirs);
  box.cleanup();
});

test('a dry run prints the plan and writes nothing', () => {
  const box = sandbox();
  const result = install(box, '--dry-run');
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /would link/);
  assert.deepEqual(entries(box.home), []);
  box.cleanup();
});

test('a dry run ends the way a real install does, marked as a preview, with the apps it would not reach', () => {
  const box = sandbox();
  fs.mkdirSync(path.join(box.home, '.claude'), { recursive: true });
  const before = entries(box.home);
  const dry = install(box, '--dry-run', '--also', 'cursor');
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Dry run\. Nothing changed\.\nA real install ends with a check of the result \(it runs after the changes, so not now\) and these lines:\n/);
  assert.match(dry.out, /\n  Installed\. Call the 100x skill with a brief in a new thread\. `\/100x` in Cursor\./);
  assert.match(dry.out, new RegExp(`\\n  ${MODES_LINE}\\n`), 'the preview names the mode skills too');
  assert.match(dry.out, /\n  Claude Code is on this machine and reads its own skills folder[^\n]*--also claude`/);
  assert.doesNotMatch(dry.out, /\nDoctor\n/, 'the check runs after the changes, so a dry run does not run it');
  assert.deepEqual(entries(box.home), before, 'nothing was written');
  const real = install(box, '--also', 'cursor');
  assert.match(real.out, new RegExp(`\\nInstalled\\. Call the 100x skill with a brief in a new thread\\. \`/100x\` in Cursor\\.\\n${MODES_LINE}\\nClaude Code is on this machine`), 'the real ending is the same three lines');
  const gone = install(box, '--uninstall', '--dry-run');
  assert.match(gone.out, /A real uninstall ends with this line:\n  Uninstalled\. Your data in the 100x home folder/);
  box.cleanup();
});

test('a real folder in the way is never replaced, even with --force, and the rest still installs', () => {
  const box = sandbox();
  const where = layout(box);
  write(path.join(where.skills, '100x', 'notes.txt'), 'mine');
  const result = install(box, '--force');
  assert.equal(result.code, 1);
  assert.match(result.out, /blocked/);
  assert.equal(fs.readFileSync(path.join(where.skills, '100x', 'notes.txt'), 'utf8'), 'mine');
  if (WINDOWS) assert.ok(fs.existsSync(path.join(where.global, 'bin', '100x.cmd')));
  else assert.ok(fs.lstatSync(path.join(where.global, 'bin', '100x')).isSymbolicLink());
  box.cleanup();
});

test('a link that points elsewhere is a conflict until --force, and uninstall restores it', () => {
  const box = sandbox();
  const where = layout(box);
  const other = path.join(box.dir, 'other-setup');
  write(path.join(other, 'SKILL.md'), 'other');
  fs.mkdirSync(where.skills, { recursive: true });
  symlink(other, path.join(where.skills, '100x'));

  const refused = install(box);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /already points to .*other-setup/);
  assert.equal(fs.realpathSync(path.join(where.skills, '100x')), fs.realpathSync(other));

  const forced = install(box, '--force');
  assert.equal(forced.code, 0, forced.out + forced.err);
  assert.equal(fs.realpathSync(path.join(where.skills, '100x')), fs.realpathSync(path.join(ROOT, 'skills', '100x')));

  const removed = cli(['install', '--uninstall'], { env: box.env });
  assert.equal(removed.code, 0, removed.err);
  assert.equal(fs.realpathSync(path.join(where.skills, '100x')), fs.realpathSync(other));
  box.cleanup();
});

test('uninstall removes only what the installer made and keeps edited files and data', () => {
  const box = sandbox();
  const where = layout(box);
  write(path.join(where.skills, 'someone-elses-skill', 'SKILL.md'), 'theirs');
  fs.mkdirSync(where.bin, { recursive: true });
  fs.writeFileSync(path.join(where.bin, 'other-tool'), '#!/bin/sh\n');
  install(box);
  fs.writeFileSync(path.join(where.global, 'profile.md'), 'my own profile\n');
  write(path.join(where.global, 'runs.jsonl'), '{"run":1}\n');

  const removed = cli(['install', '--uninstall'], { env: box.env });
  assert.equal(removed.code, 0, removed.err);
  assert.deepEqual(entries(where.skills), ['someone-elses-skill']);
  assert.deepEqual(entries(where.bin), ['other-tool']);
  assert.deepEqual(entries(where.global), ['profile.md', 'runs.jsonl']);
  assert.match(removed.out, /you edited it/);
  box.cleanup();
});

test('uninstall of an untouched install leaves no trace but the folders that existed before', () => {
  const box = sandbox();
  const where = layout(box);
  fs.mkdirSync(where.skills, { recursive: true });
  install(box);
  const removed = cli(['install', '--uninstall'], { env: box.env });
  assert.equal(removed.code, 0, removed.err);
  assert.deepEqual(entries(where.skills), []);
  assert.equal(fs.existsSync(where.global), false);
  assert.equal(fs.existsSync(where.bin), false);
  box.cleanup();
});

test('uninstall without a record says there is nothing to remove', () => {
  const box = sandbox();
  const result = cli(['install', '--uninstall'], { env: box.env });
  assert.equal(result.code, 0);
  assert.match(result.out, /not recorded/);
  box.cleanup();
});

test('an unslop-text checkout is linked when given, and a bad path is reported without failing the install', () => {
  const box = sandbox();
  const where = layout(box);
  const text = fakeCheckout(box, 'unslop-text');
  const result = cli(['install', '--unslop-text', text], { env: box.env });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.realpathSync(path.join(where.skills, 'unslop-text')), fs.realpathSync(path.join(text, 'skills', 'unslop-text')));
  const bad = cli(['install', '--force', '--unslop-text', path.join(box.dir, 'nope')], { env: box.env });
  assert.equal(bad.code, 0, bad.out + bad.err);
  assert.match(bad.out, /missing .*unslop-text/);
  const removed = cli(['install', '--uninstall'], { env: box.env });
  assert.equal(fs.existsSync(path.join(where.skills, 'unslop-text')), false, removed.out);
  box.cleanup();
});

test('without a checkout the pinned copy in vendor/ is linked, and uninstall removes that link', () => {
  const box = sandbox();
  const where = layout(box);
  const result = cli(['install'], { env: box.env });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.realpathSync(path.join(where.skills, 'unslop-text')), fs.realpathSync(path.join(ROOT, 'vendor', 'unslop-text')));
  assert.ok(fs.existsSync(path.join(where.skills, 'unslop-text', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(where.skills, 'unslop-design')), false, 'unslop-design is not part of 100x, so it is never linked');
  cli(['install', '--uninstall'], { env: box.env });
  assert.deepEqual(entries(where.skills), []);
  box.cleanup();
});

test('a link to your own copy of unslop-text is kept, never recorded, and --force swaps it for the pinned one', () => {
  const box = sandbox();
  const where = layout(box);
  const mine = fakeCheckout(box, 'unslop-text');
  fs.mkdirSync(where.skills, { recursive: true });
  symlink(path.join(mine, 'skills', 'unslop-text'), path.join(where.skills, 'unslop-text'));
  const kept = cli(['install'], { env: box.env });
  assert.equal(kept.code, 0, kept.out + kept.err);
  assert.match(kept.out, /kept\s+.*unslop-text\s+points to .* a copy of unslop-text you chose/);
  assert.equal(fs.realpathSync(path.join(where.skills, 'unslop-text')), fs.realpathSync(path.join(mine, 'skills', 'unslop-text')));
  cli(['install', '--uninstall'], { env: box.env });
  assert.ok(fs.lstatSync(path.join(where.skills, 'unslop-text')).isSymbolicLink(), 'uninstall leaves the link the owner made');
  const forced = cli(['install', '--force'], { env: box.env });
  assert.equal(forced.code, 0, forced.out + forced.err);
  assert.equal(fs.realpathSync(path.join(where.skills, 'unslop-text')), fs.realpathSync(path.join(ROOT, 'vendor', 'unslop-text')));
  box.cleanup();
});

test('an install from before unslop-design left 100x loses the link to the removed copy and gets the owner link back', () => {
  const box = sandbox();
  const where = layout(box);
  const mine = fakeCheckout(box, 'unslop-design');
  const own = path.join(mine, 'skills', 'unslop-design');
  assert.equal(cli(['install'], { env: box.env }).code, 0);
  // What an older 100x left behind: a link to vendor/unslop-design, which replaced the one the owner had made, recorded in install.json.
  const gone = path.join(ROOT, 'vendor', 'unslop-design');
  const link = path.join(where.skills, 'unslop-design');
  symlink(gone, link);
  const manifestFile = path.join(where.global, 'install.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.links.push({ path: link, target: gone, replaced: own });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const again = cli(['install'], { env: box.env });
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, /removed\s+.*unslop-design\s+the skill it pointed at, .* is no longer in this repo\. Restored the link you had made/);
  assert.equal(fs.realpathSync(link), fs.realpathSync(own), 'the owner link is back');
  assert.equal(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).links.some((l) => l.path === link), false, 'the link is no longer recorded as 100x\'s');
  cli(['install', '--uninstall'], { env: box.env });
  assert.equal(fs.realpathSync(link), fs.realpathSync(own), 'uninstall leaves the owner link');
  box.cleanup();
});

test('an old install record that lists the removed link twice is cleaned up once, without an error', () => {
  const box = sandbox();
  const where = layout(box);
  assert.equal(cli(['install'], { env: box.env }).code, 0);
  const gone = path.join(ROOT, 'vendor', 'unslop-design');
  const link = path.join(where.skills, 'unslop-design');
  symlink(gone, link);
  const manifestFile = path.join(where.global, 'install.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.links.push({ path: link, target: gone }, { path: link, target: gone });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const again = cli(['install'], { env: box.env });
  assert.equal(again.code, 0, again.out + again.err);
  assert.equal(again.out.split('\n').filter((line) => /removed\s+.*unslop-design/.test(line)).length, 1, 'one line for one link');
  assert.equal(fs.existsSync(link), false);
  box.cleanup();
});

test('an old install record that lists the removed link twice gives the owner link back whichever record came first', () => {
  for (const order of ['without first', 'with first']) {
    const box = sandbox();
    const where = layout(box);
    const own = path.join(fakeCheckout(box, 'unslop-design'), 'skills', 'unslop-design');
    assert.equal(cli(['install'], { env: box.env }).code, 0);
    const gone = path.join(ROOT, 'vendor', 'unslop-design');
    const link = path.join(where.skills, 'unslop-design');
    symlink(gone, link);
    const manifestFile = path.join(where.global, 'install.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const plain = { path: link, target: gone };
    const kept = { path: link, target: gone, replaced: own };
    manifest.links.push(...(order === 'with first' ? [kept, plain] : [plain, kept]));
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const again = cli(['install'], { env: box.env });
    assert.equal(again.code, 0, again.out + again.err);
    assert.equal(fs.realpathSync(link), fs.realpathSync(own), `the owner link is back with the record ${order}`);
    box.cleanup();
  }
});

test('--no-bin skips the PATH entry and prints a hint when the folder is not on PATH', () => {
  const box = sandbox();
  const where = layout(box);
  assert.equal(install(box, '--no-bin').code, 0);
  assert.equal(fs.existsSync(where.bin), false);
  const hinted = install(box);
  assert.match(hinted.out, /is not on PATH/);
  box.cleanup();
});

test('scripts/install.sh forwards to the CLI, including --help and --dry-run', () => {
  const box = sandbox();
  const script = path.join(ROOT, 'scripts', 'install.sh');
  const help = spawnSync(BASH, [script.replaceAll('\\', '/'), '--help'], { encoding: 'utf8', env: { ...process.env, ...box.env } });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--uninstall/);
  const dry = spawnSync(BASH, [script.replaceAll('\\', '/'), '--no-unslop', '--dry-run'], { encoding: 'utf8', env: { ...process.env, ...box.env } });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run/);
  assert.deepEqual(entries(box.home), []);
  box.cleanup();
});

test('a symlink planted where install writes a small file is left alone, and so is what it points at', { skip: noFileLinks }, () => {
  const box = sandbox();
  const where = layout(box);
  const precious = path.join(box.dir, 'precious.txt');
  fs.writeFileSync(precious, 'PRECIOUS DO NOT OVERWRITE\n');
  fs.mkdirSync(where.global, { recursive: true });
  symlink(precious, path.join(where.global, 'repo'));
  const result = cli(['install', '--no-unslop', '--json'], { env: box.env });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.readFileSync(precious, 'utf8'), 'PRECIOUS DO NOT OVERWRITE\n');
  const repoEvent = JSON.parse(result.out).events.find((e) => e.path === path.join(where.global, 'repo'));
  assert.equal(repoEvent.status, 'kept');
  assert.match(repoEvent.detail, /is a symlink, so nothing is written through it/);
  assert.equal(fs.lstatSync(path.join(where.global, 'repo')).isSymbolicLink(), true);
  box.cleanup();
});

test('an install record that is a symlink stops the install before anything changes', { skip: noFileLinks }, () => {
  const box = sandbox();
  const where = layout(box);
  const precious = path.join(box.dir, 'precious.json');
  fs.writeFileSync(precious, '{"mine":true}\n');
  fs.mkdirSync(where.global, { recursive: true });
  symlink(precious, path.join(where.global, 'install.json'));
  const result = cli(['install', '--no-unslop'], { env: box.env });
  assert.equal(result.code, 1);
  assert.match(result.out + result.err, /install\.json.*is a symlink/);
  assert.equal(fs.readFileSync(precious, 'utf8'), '{"mine":true}\n');
  assert.deepEqual(entries(where.skills), [], 'no skill was linked');
  assert.equal(fs.existsSync(path.join(where.global, 'bin')), false);
  box.cleanup();
});

test('--also links the skills into other apps folders too, and uninstall removes only what was made', () => {
  const box = sandbox();
  const result = install(box, '--also', 'claude,codex');
  assert.equal(result.code, 0, result.out + result.err);
  for (const dir of [['.claude', 'skills'], ['.codex', 'skills'], ['.agents', 'skills']]) {
    for (const name of SKILLS) assert.equal(fs.realpathSync(path.join(box.home, ...dir, name)), fs.realpathSync(path.join(ROOT, 'skills', name)));
  }
  assert.equal(fs.existsSync(path.join(box.home, '.cursor')), false, 'an app that was not named is left alone');
  const bad = install(box, '--also', 'nope');
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /Unknown app "nope"/);
  const undo = cli(['install', '--uninstall'], { env: box.env });
  assert.equal(undo.code, 0, undo.out + undo.err);
  for (const dir of [['.claude', 'skills'], ['.codex', 'skills']]) assert.deepEqual(entries(path.join(box.home, ...dir)), []);
  box.cleanup();
});

test('install takes out a link whose skill was renamed away, and leaves other links alone', () => {
  const box = sandbox();
  const where = layout(box);
  install(box);
  const stale = path.join(where.skills, '100x-old-name');
  const gone = path.join(ROOT, 'skills', '100x-old-name');
  symlink(gone, stale);
  const kept = path.join(where.skills, 'kept-link');
  symlink(path.join(ROOT, 'skills', '100x'), kept);
  const manifestFile = path.join(where.global, 'install.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.links.push({ path: stale, target: gone }, { path: kept, target: path.join(ROOT, 'skills', '100x') });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const again = cli(['install', '--no-unslop', '--json'], { env: box.env });
  assert.equal(again.code, 0, again.err);
  assert.equal(fs.existsSync(stale), false);
  assert.match(again.out, /removed/);
  assert.equal(fs.lstatSync(kept).isSymbolicLink(), true);
  box.cleanup();
});

test('install takes out a link whose skill was renamed away, and leaves other links alone', () => {
  const box = sandbox();
  const where = layout(box);
  install(box);
  const stale = path.join(where.skills, '100x-old-name');
  const gone = path.join(ROOT, 'skills', '100x-old-name');
  symlink(gone, stale);
  const kept = path.join(where.skills, 'kept-link');
  symlink(path.join(ROOT, 'skills', '100x'), kept);
  const manifestFile = path.join(where.global, 'install.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.links.push({ path: stale, target: gone }, { path: kept, target: path.join(ROOT, 'skills', '100x') });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const again = cli(['install', '--no-unslop', '--json'], { env: box.env });
  assert.equal(again.code, 0, again.err);
  assert.equal(fs.existsSync(stale), false);
  assert.match(again.out, /removed/);
  assert.equal(fs.lstatSync(kept).isSymbolicLink(), true);
  box.cleanup();
});

test('skill folders that npx skills add copied count as installed: the installer and doctor accept them and say when one differs', () => {
  const box = sandbox();
  const where = layout(box);
  for (const name of SKILLS) fs.cpSync(path.join(ROOT, 'skills', name), path.join(where.skills, name), { recursive: true });
  const result = install(box);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /blocked|conflict/);
  assert.equal(result.out.match(/link {3}present {8}\S+ {2}a copy of this skill[^\n]*with the same files as this checkout/g).length, SKILLS.length, 'every copy is reported as present, none replaced');
  for (const name of SKILLS) assert.ok(!fs.lstatSync(path.join(where.skills, name)).isSymbolicLink(), `${name} is still the copy`);
  const checks = () => JSON.parse(cli(['doctor', '--json'], { cwd: box.project, env: box.env }).out);
  const row = (name) => checks().find((c) => c.name === `skill ${name}`);
  assert.equal(row('100x-status').status, 'ok');
  assert.match(row('100x-status').detail, /is a copy, the same files as this checkout/);
  fs.appendFileSync(path.join(where.skills, '100x-status', 'SKILL.md'), '\nAn older line.\n');
  assert.equal(row('100x-status').status, 'warn');
  assert.match(row('100x-status').detail, /is a copy that differs from this checkout/);
  assert.match(row('100x-status').fix, /npx skills update -g/);
  const again = install(box);
  assert.equal(again.code, 1, 'a differing core copy must not be reported as a current installation');
  assert.match(again.out, /100x-status {2}a copy that differs from this checkout\. Refresh it with `npx skills update -g`/);
  assert.match(again.out, /Installation incomplete/);
  assert.equal(fs.readFileSync(path.join(where.skills, '100x-status', 'SKILL.md'), 'utf8').endsWith('An older line.\n'), true, 'the copy is left as it was');
  const gone = install(box, '--uninstall');
  assert.equal(gone.code, 0);
  for (const name of SKILLS) assert.ok(fs.existsSync(path.join(where.skills, name, 'SKILL.md')), `uninstall leaves ${name}, which it did not make`);
  box.cleanup();
});
