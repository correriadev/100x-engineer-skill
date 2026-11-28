import fs from 'node:fs';
import path from 'node:path';
import { parseSkillFrontmatter } from './skill-spec.mjs';

// What every SKILL.md of this repo says about itself beyond its name and description. It comes from package.json and one sentence here, so a release
// edits one file and `node scripts/stamp-skills.mjs` carries it to every skill. `100x validate` fails when a skill drifts from it.
export const COMPATIBILITY = 'Needs the 100x command line tool on PATH (Node 22 or newer, and git) and the other skills of the 100x suite that this one names. Install the tool as the repository README says. Browser checks use Playwright, which `100x browsers` installs.';

export const repositoryUrl = (pkg) => String(pkg.repository?.url ?? pkg.repository ?? '').replace(/^git\+/, '').replace(/\.git$/, '');

const WORKBENCH_SKILLS = new Set(['project-mapper', 'new-scope', 'execute-scope', 'qa-scope']);
const WORKBENCH_COMPATIBILITY = 'Python 3.12+ with SQLite 3.37+ and Git. The 100x adapter needs Node 22+. C# parsing and browser checks use optional dependencies.';

export function readStamp(root, skill = '') {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const repository = repositoryUrl(pkg);
  if (!pkg.license || !repository) return null;
  const owner = /github\.com\/([^/]+)\//.exec(repository)?.[1] ?? pkg.author;
  if (WORKBENCH_SKILLS.has(skill)) return { license: pkg.license, compatibility: WORKBENCH_COMPATIBILITY, metadata: { author: 'correriadev', version: pkg.version, repository: 'https://github.com/correriadev/agentic-workbench' } };
  return { license: pkg.license, compatibility: COMPATIBILITY, metadata: { author: owner, version: pkg.version, repository } };
}

const lines = (stamp) => [
  `license: ${stamp.license}`,
  `compatibility: ${JSON.stringify(stamp.compatibility)}`,
  'metadata:',
  ...Object.entries(stamp.metadata).map(([key, value]) => `  ${key}: ${JSON.stringify(String(value))}`),
];

// The front matter of `text` with the stamp written after the description, and any earlier license, compatibility or metadata lines replaced.
export function stampText(text, stamp) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) throw new Error('no front matter to stamp');
  const kept = [];
  let skipping = false;
  for (const line of match[1].split('\n')) {
    const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1];
    if (key) skipping = ['license', 'compatibility', 'metadata'].includes(key);
    if (!skipping) kept.push(line);
  }
  const at = kept.findIndex((line) => line.startsWith('description:'));
  kept.splice(at + 1, 0, ...lines(stamp));
  return `---\n${kept.join('\n')}\n---${text.slice(match[0].length)}`;
}

// The ways a skill's front matter differs from the stamp, one sentence each.
export function stampProblems(text, stamp) {
  const front = parseSkillFrontmatter(text);
  if (!front) return [];
  const out = [];
  if (front.fields.license !== stamp.license) out.push(`license is "${front.fields.license ?? ''}", package.json says "${stamp.license}"`);
  if (front.fields.compatibility !== stamp.compatibility) out.push('compatibility is missing or not the stamped sentence');
  for (const [key, value] of Object.entries(stamp.metadata)) if (front.metadata?.[key] !== String(value)) out.push(`metadata ${key} is "${front.metadata?.[key] ?? ''}", it should be "${value}"`);
  return out;
}
