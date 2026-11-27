import fs from 'node:fs';
import path from 'node:path';
import { posix } from './paths.mjs';
import { readStamp, stampProblems } from './skill-meta.mjs';
import { parseFrontmatter, parseSkillFrontmatter, specFindings } from './skill-spec.mjs';

export { parseFrontmatter };

const LONG_DASH = /[\u2013\u2014]/;
const PLACEHOLDER = /\b(TODO|FIXME|XXX|lorem ipsum)\b/i;
const LINE_BUDGET = { router: 170, skill: 130 };
// `templates` and `modes` stay in the list so a stale pointer into a folder that used to exist fails as a file that does not exist. A path that starts
// with ../name/ is a pointer out of the skill, which the spec rules report once, as spec-escape.
const PATH_MENTION = /(?<!\.\.\/[A-Za-z0-9_.-]+\/)(?:references|assets|templates|modes)\/[A-Za-z0-9_./-]*[A-Za-z0-9_]\.(?:md|mjs|json|html|tsv|sh|css|js)/g;

function listFiles(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out.sort();
}

const FLAGS = /(?:^|\s)(--[a-z][a-z0-9-]*)/g;

function flagsIn(rest) {
  const [segment] = rest.split(/&&|\|\||[|;>]/);
  return [...segment.matchAll(FLAGS)].map((m) => m[1]);
}

export function commandInvocations(text) {
  const found = [];
  const body = text.replace(/^```[^\n]*\n([\s\S]*?)^```/gm, (_, block) => {
    for (const line of block.split('\n')) {
      const hit = /^\s*(?:\$\s+)?(?:~\/\.100x\/bin\/)?100x\s+([a-z][a-z-]*)\b(.*)$/.exec(line);
      if (hit) found.push({ command: hit[1], flags: flagsIn(hit[2]) });
    }
    return '';
  });
  for (const span of body.matchAll(/`([^`\n]+)`/g)) {
    if (/^\/100x[\s-]/.test(span[1])) continue; // a slash call of the skill, such as `/100x an idle game`, is not the command line tool
    const hit = /(?:^|[\s/])100x\s+([a-z][a-z-]*)\b(.*)$/.exec(span[1]);
    if (hit) found.push({ command: hit[1], flags: flagsIn(hit[2]) });
  }
  return found;
}

export const commandMentions = (text) => commandInvocations(text).map((i) => i.command);

const usageFlags = (usage) => new Set([...(usage ?? '').matchAll(/--[a-z][a-z0-9-]*/g)].map((m) => m[0]));

export function validateRepo(root, { commands = [], usages = {} } = {}) {
  const findings = [];
  const add = (level, file, rule, message) => findings.push({ level, file: posix(path.relative(root, file)) || '.', rule, message });
  const known = new Set([...commands, 'help', 'version']);
  const skillsRoot = path.join(root, 'skills');
  const names = fs.existsSync(skillsRoot) ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];

  const stamp = readStamp(root);
  for (const name of names) {
    const dir = path.join(skillsRoot, name);
    const skillFile = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      add('error', dir, 'skill-file', 'folder has no SKILL.md');
      continue;
    }
    const text = fs.readFileSync(skillFile, 'utf8');
    const front = parseSkillFrontmatter(text);
    if (!front) {
      add('error', skillFile, 'frontmatter', 'missing frontmatter block');
      continue;
    }
    const { description } = front.fields;
    for (const found of specFindings({ name, text, dir, siblings: names })) add('error', skillFile, found.rule, found.message);
    if (stamp) for (const problem of stampProblems(text, readStamp(root, name))) add('error', skillFile, 'skill-stamp', `${problem}. Run \`node scripts/stamp-skills.mjs\``);
    if (!description || ['>', '|', '>-', '|-'].includes(description)) {
      add('error', skillFile, 'description', 'description must be one line of plain text');
    } else {
      if (description.length > 1024) add('error', skillFile, 'description-length', `${description.length} characters, limit 1024`);
      if (!/\bUse (when|for)\b/.test(description)) add('error', skillFile, 'description-trigger', 'description needs "Use when" or "Use for" trigger words');
    }
    if (front.fields['disable-model-invocation'] === 'true') add('error', skillFile, 'model-invocation', 'A skill that sets disable-model-invocation cannot be called by the agent, so the modes could not call each other. Remove the key.');
    const budget = name === '100x' ? LINE_BUDGET.router : LINE_BUDGET.skill;
    const lines = text.split('\n').length;
    if (lines > budget) add('error', skillFile, 'line-budget', `${lines} lines, budget ${budget}. Move detail into references/.`);

    const docs = listFiles(dir, (file) => file.endsWith('.md'));
    for (const file of docs) {
      const body = fs.readFileSync(file, 'utf8');
      for (const mention of new Set(body.match(PATH_MENTION) ?? [])) {
        const target = path.resolve(dir, mention);
        if (!fs.existsSync(target) && !fs.existsSync(path.resolve(path.dirname(file), mention))) add('error', file, 'reference-missing', `${mention} does not exist`);
      }
      for (const link of body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = link[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        if (!fs.existsSync(path.resolve(path.dirname(file), target)) && !fs.existsSync(path.resolve(dir, target))) add('error', file, 'link-missing', `link ${link[1]} does not resolve`);
      }
    }
    if (fs.existsSync(path.join(dir, 'modes'))) add('error', path.join(dir, 'modes'), 'modes-folder', `${name} has a modes folder. A mode is a skill of its own, skills/<name>/SKILL.md, so the owner picks it by calling it and no word in a brief can`);
    // The spec wants every bundled file one hop from SKILL.md. A reference only another reference names is two hops, and an agent that reads
    // SKILL.md and stops there never learns it exists.
    const pointsTo = (file, rel) => file !== path.join(dir, rel) && fs.readFileSync(file, 'utf8').includes(rel);
    for (const folder of ['references', 'assets']) {
      for (const bundled of listFiles(path.join(dir, folder), (file) => folder === 'assets' || file.endsWith('.md'))) {
        const rel = path.relative(dir, bundled).split(path.sep).join('/');
        if (!docs.some((file) => pointsTo(file, rel))) add('error', bundled, 'reference-orphan', `nothing in ${name} points to ${rel}`);
        else if (folder === 'references' && !pointsTo(skillFile, rel)) add('error', bundled, 'reference-depth', `SKILL.md does not name ${rel}, only another reference does. Name it in SKILL.md so it is one hop away`);
      }
    }
  }

  if (commands.length) {
    const compare = (file, listed, where) => {
      const missing = commands.filter((name) => !listed.includes(name));
      const extra = listed.filter((name) => !commands.includes(name));
      if (missing.length || extra.length) add('error', file, 'command-list', `${where} is out of date with the CLI${missing.length ? `. Missing ${missing.join(', ')}` : ''}${extra.length ? `. Not commands ${extra.join(', ')}` : ''}`);
    };
    const design = path.join(root, 'docs', 'design.md');
    const designList = fs.existsSync(design) ? /`100x ((?:[a-z][a-z-]*\|)+[a-z][a-z-]*)`/.exec(fs.readFileSync(design, 'utf8')) : null;
    if (designList) compare(design, designList[1].split('|'), 'the command list');
    const readme = path.join(root, 'README.md');
    const cliTable = fs.existsSync(readme) ? /^## The CLI\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(fs.readFileSync(readme, 'utf8')) : null;
    if (cliTable) compare(readme, [...cliTable[1].matchAll(/^\|\s*`([a-z][a-z-]*)`\s*\|/gm)].map((m) => m[1]), 'the CLI table');
  }

  const prose = [...listFiles(skillsRoot, (f) => f.endsWith('.md') && !f.split(path.sep).includes('tests')), ...listFiles(path.join(root, 'docs'), (f) => f.endsWith('.md')), ...['README.md'].map((f) => path.join(root, f)).filter(fs.existsSync)];
  for (const file of prose) {
    const body = fs.readFileSync(file, 'utf8');
    body.split('\n').forEach((line, index) => {
      if (LONG_DASH.test(line)) add('error', file, 'long-dash', `line ${index + 1} has a long dash. Use a period, comma or parentheses`);
      if (PLACEHOLDER.test(line)) add('error', file, 'placeholder', `line ${index + 1} has a placeholder word`);
    });
    if (known.size > 2) {
      const seen = new Set();
      for (const { command, flags } of commandInvocations(body)) {
        if (!known.has(command)) {
          if (!seen.has(command)) add('error', file, 'command-unknown', `\`100x ${command}\` is not a command`);
          seen.add(command);
          continue;
        }
        const allowed = usageFlags(usages[command]);
        for (const flag of flags) {
          if (!usages[command] || ['--help', '--version'].includes(flag) || allowed.has(flag) || seen.has(`${command} ${flag}`)) continue;
          seen.add(`${command} ${flag}`);
          add('error', file, 'flag-unknown', `\`100x ${command}\` has no ${flag} flag. \`100x help ${command}\` lists them`);
        }
      }
    }
  }
  return findings;
}
