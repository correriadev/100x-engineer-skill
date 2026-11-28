#!/usr/bin/env node
// Writes license, compatibility and metadata into the front matter of every skills/*/SKILL.md from package.json. Run it after a version bump
// or a change of the repository URL. `100x validate` fails while a skill disagrees with package.json. Nothing here changes a name or a description.
import fs from 'node:fs';
import path from 'node:path';
import { readStamp, stampText } from '../lib/skill-meta.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

const stamp = readStamp(REPO_ROOT);
const check = process.argv.slice(2).includes('--check');
if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  console.error('usage: node scripts/stamp-skills.mjs [--check]');
  process.exit(2);
}
if (!stamp) {
  console.error('package.json needs a license and a repository url before the skills can be stamped.');
  process.exit(1);
}
let changed = 0;
for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'skills'), { withFileTypes: true })) {
  const file = path.join(REPO_ROOT, 'skills', entry.name, 'SKILL.md');
  if (!entry.isDirectory() || !fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = stampText(before, readStamp(REPO_ROOT, entry.name));
  if (after !== before) {
    if (!check) fs.writeFileSync(file, after);
    changed += 1;
  }
}
console.log(changed ? check ? `${changed} skill${changed === 1 ? '' : 's'} need stamping` : `stamped ${changed} skill${changed === 1 ? '' : 's'}` : 'every skill already carries the stamp');
if (check && changed) process.exitCode = 1;
