import fs from 'node:fs';
import path from 'node:path';
import { repositoryUrl } from './skill-meta.mjs';

// The Claude plugin is its own folder because the directory scans and ships only the folder that holds `.claude-plugin/plugin.json`, and this repository is
// much more than that: the CLI, the tests, the benchmarks and the docs. The folder holds the skills, a manifest, a README, an icon and the two notices. All of
// it except the two files in HAND_WRITTEN is written by `node scripts/build-claude-plugin.mjs` from package.json, skills/, LICENSE and NOTICE.md, so a release
// edits those and nothing else. A symbolic link would be refused by the directory, so every file is a real copy.
export const PLUGIN_DIR = path.join('plugins', '100x');
// Not `100x`: the directory refuses a name that looks like another once 1 reads as l and 0 as o (`100x` ~ `loot`, `Loop`). The name is permanent once listed, and
// it is the prefix of every call in Claude Code, so a change goes through `/100x-engineer:` in the skills and the README as well. The test keeps them equal.
export const PLUGIN_NAME = '100x-engineer';
export const DISPLAY_NAME = '100x Engineer';
// The directory takes the listing icon from the first submission only, so it is a file of its own and the build never rewrites it.
export const ICON = 'assets/icon.png';
export const HAND_WRITTEN = ['README.md', ICON];
export const AUTHOR_NAME = 'correriadev';
export const DESCRIPTION =
  'Runs one brief from plan to a reviewed, screenshot-proven prototype with a report: build, polish, a check on the one thing that must not break, and rounds of review by a second model. Needs the separate 100x command line tool.';

// What the directory lets through without a reviewer reading it. See https://claude.com/docs/plugins/pre-submission-checklist
export const LIMITS = { maxFiles: 512, maxTextBytes: 256 * 1024, minReadmeWords: 40 };

export function pluginManifest(pkg) {
  const repository = repositoryUrl(pkg);
  const owner = /github\.com\/([^/]+)\//.exec(repository)?.[1];
  return {
    name: PLUGIN_NAME,
    displayName: DISPLAY_NAME,
    icon: `./${ICON}`,
    version: pkg.version,
    description: DESCRIPTION,
    author: { name: AUTHOR_NAME, url: `https://github.com/${owner}` },
    homepage: repository,
    repository,
    license: pkg.license,
    keywords: pkg.keywords,
  };
}

// Every file under `dir` as a path with `/`, relative to `dir`, sorted. A missing folder has none.
export function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return out.sort();
}

// The directory takes a script only from a Verified organization, and the portal blocks the submission for any other: see LOCAL_CODE_FILE_TYPE in its report. The
// skills keep their templates as real scripts, which the tests run, and the plugin ships each one as a Markdown file that holds the same code.
export const SCRIPT = /\.(mjs|cjs|js|jsx|ts|tsx|sh|bash|zsh|py|rb|ps1|bat|cmd)$/i;
const WORKBENCH_TOOLS = { 'project-mapper': 'mapper', 'new-scope': 'scope', 'execute-scope': 'execute', 'qa-scope': 'qa' };

// A script as the Markdown file the plugin ships: what it is, what to do with it, and the whole code in one fenced block. `scriptCode` is the way back.
export function scriptAsMarkdown(name, source) {
  const fence = '`'.repeat(Math.max(3, ...(source.match(/`+/g) ?? []).map((run) => run.length + 1)));
  const body = source.endsWith('\n') ? source : `${source}\n`;
  return `# ${name}\n\nThe Claude plugin ships this script as Markdown, because the directory takes no script files. Save the code below as a file named \`${name}\`, for example in \`.100x/must-not-break/\`, and run it from there as the skill says. It needs only Node.js.\n\n${fence}js\n${body}${fence}\n`;
}

// The code in a file that `scriptAsMarkdown` wrote.
export function scriptCode(markdown) {
  const lines = markdown.split('\n');
  const open = lines.findIndex((line) => /^`{3,}js$/.test(line));
  const fence = lines[open].slice(0, -2);
  return `${lines.slice(open + 1, lines.lastIndexOf(fence)).join('\n')}\n`;
}

// What a skill with scripts tells the agent once they are Markdown, added to the end of its SKILL.md in the plugin.
const SCRIPT_NOTE = '\n## In the Claude plugin\n\nThe directory takes no script files, so each script named under `assets/` is a Markdown file with `.md` added to its name, such as `assets/asset-check.mjs.md`. Its code block is the whole script. Save the code as a file with the original name in the project, for example in `.100x/must-not-break/`, and run it from there as written above.\n';

// The files the build owns, as relative path -> contents. The files in HAND_WRITTEN are not among them.
export function generatedFiles(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = new Map();
  files.set('.claude-plugin/plugin.json', Buffer.from(`${JSON.stringify(pluginManifest(pkg), null, 2)}\n`));
  for (const name of ['LICENSE', 'NOTICE.md']) files.set(name, fs.readFileSync(path.join(root, name)));
  const withScripts = new Set();
  for (const rel of listFiles(path.join(root, 'skills'))) {
    const skill = rel.split('/')[0];
    const tool = WORKBENCH_TOOLS[skill];
    // The real interdependent Python package is shipped with the 100x CLI. The
    // plugin calls it through the adapter, so no module has to be reconstructed.
    if (tool && (/\/tests\//.test(rel) || /\.(?:py|sql)$/i.test(rel) || /\/requirements[^/]*\.txt$/i.test(rel))) continue;
    let bytes = fs.readFileSync(path.join(root, 'skills', rel));
    if (tool && rel.endsWith('.md')) {
      let content = bytes.toString('utf8')
        .replaceAll('python "<mapper>"', '100x workbench mapper')
        .replaceAll('python MAPPER ROOT', '100x workbench mapper ROOT')
        .replaceAll('python "<contract>"', '100x workbench scope')
        .replaceAll('python /path/to/new-scope/contract.py', '100x workbench scope')
        .replaceAll('Run the bundled `contract.py` next to this SKILL.md with Python 3.9+.', `Run \`100x workbench ${tool}\` with Python 3.12+.`)
        .replaceAll('"<skill>/scripts/requirements-csharp.txt"', '"<path from 100x workbench path mapper>/scripts/requirements-csharp.txt"')
        .replace(/\[project_mapper\.py\]\(scripts\/project_mapper\.py\)/g, '`100x workbench mapper`')
        .replace(/\[schema\.sql\]\(\.\.\/schema\.sql\)/g, '`schema.sql` in the installed New Scope package');
      if (rel.endsWith('/SKILL.md')) content += `\n## Python runtime in this plugin\n\nUse \`100x workbench ${tool}\` to run this skill's installed Python tool. The CLI package contains its complete modules and schema; do not reconstruct scripts from Markdown. Use \`100x workbench path ${tool}\` to locate installed resources.\n`;
      bytes = Buffer.from(content);
    }
    if (!SCRIPT.test(rel)) files.set(`skills/${rel}`, bytes);
    else {
      files.set(`skills/${rel}.md`, Buffer.from(scriptAsMarkdown(path.basename(rel), bytes.toString('utf8'))));
      withScripts.add(rel.split('/')[0]);
    }
  }
  for (const skill of withScripts) {
    const key = `skills/${skill}/SKILL.md`;
    files.set(key, Buffer.concat([files.get(key), Buffer.from(SCRIPT_NOTE)]));
  }
  return files;
}

// The ways the plugin folder differs from what the build would write: a file that is missing, one that differs, and one the build does not own.
export function pluginProblems(root) {
  const dir = path.join(root, PLUGIN_DIR);
  const want = generatedFiles(root);
  const problems = [];
  for (const [rel, bytes] of want) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) problems.push(`${rel} is missing`);
    else if (!fs.readFileSync(file).equals(bytes)) problems.push(`${rel} differs from its source`);
  }
  for (const rel of listFiles(dir)) if (!want.has(rel) && !HAND_WRITTEN.includes(rel)) problems.push(`${rel} is not written by the build`);
  for (const rel of HAND_WRITTEN) if (!fs.existsSync(path.join(dir, rel))) problems.push(`${rel} is missing`);
  return problems;
}

// Remove every folder under `dir` that holds nothing, deepest first. `dir` itself stays.
function pruneEmptyFolders(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    pruneEmptyFolders(sub);
    if (!fs.readdirSync(sub).length) fs.rmdirSync(sub);
  }
}

// Write the plugin folder, and remove what the build no longer owns so a renamed or deleted skill leaves nothing behind, folders included.
export function buildPlugin(root) {
  const dir = path.join(root, PLUGIN_DIR);
  const want = generatedFiles(root);
  let written = 0;
  for (const [rel, bytes] of want) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    written += 1;
  }
  let removed = 0;
  for (const rel of listFiles(dir)) {
    if (want.has(rel) || HAND_WRITTEN.includes(rel)) continue;
    fs.rmSync(path.join(dir, rel));
    removed += 1;
  }
  pruneEmptyFolders(dir);
  return { written, removed };
}
