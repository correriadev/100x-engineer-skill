import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPlugin, HAND_WRITTEN, ICON, LIMITS, listFiles, PLUGIN_DIR, pluginProblems, SCRIPT, scriptAsMarkdown, scriptCode } from '../lib/claude-plugin.mjs';
import { ROOT } from './helpers.mjs';

// These are the checks of https://claude.com/docs/plugins/pre-submission-checklist that `claude plugin validate` does not run, so a change here cannot
// leave the directory's validation to find it after a push.
const dir = path.join(ROOT, PLUGIN_DIR);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8'));
const files = listFiles(dir);
const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');

const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const TEXT = new Set(['.md', '.json', '.txt', '.tsv', '.yml', '.yaml', '.html', '.css']);

test('plugins/100x is what the build writes from package.json, skills/, LICENSE and NOTICE.md', () => {
  assert.deepEqual(pluginProblems(ROOT), [], 'run `node scripts/build-claude-plugin.mjs` and commit the result');
});

test('the manifest carries the name, version, license and author the directory reads', () => {
  assert.match(manifest.name, /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);
  assert.equal(manifest.version, pkg.version, 'raise the version with package.json on every release');
  assert.equal(manifest.license, pkg.license);
  assert.ok(manifest.description && manifest.author?.name);
  for (const key of ['hooks', 'mcpServers', 'commands', 'agents']) assert.ok(!(key in manifest), `the README says the plugin has no ${key}`);
});

test('the plugin folder holds only what the directory accepts without a reviewer', () => {
  assert.ok(files.length <= LIMITS.maxFiles, `${files.length} files, at most ${LIMITS.maxFiles}`);
  for (const rel of files) {
    const file = path.join(dir, rel);
    const ext = path.extname(rel).toLowerCase();
    assert.ok(!fs.lstatSync(file).isSymbolicLink(), `${rel} is a symbolic link`);
    assert.ok(!/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)/.test(rel), `${rel} is a system file`);
    assert.ok(IMAGES.has(ext) || TEXT.has(ext) || ['LICENSE'].includes(rel), `${rel} is not a text file or an image`);
    if (!IMAGES.has(ext)) assert.ok(fs.statSync(file).size < LIMITS.maxTextBytes, `${rel} is ${LIMITS.maxTextBytes} bytes or more`);
  }
  for (const folder of ['bin', 'hooks', 'commands', 'agents']) assert.ok(!fs.existsSync(path.join(dir, folder)), `${folder}/ stays out: a top-level bin/ stops claude.ai and Cowork from installing the plugin`);
  assert.ok(!fs.existsSync(path.join(dir, '.mcp.json')));
});

// The directory accepts these only from a Verified organization, and the portal blocks the submission for any other: see LOCAL_CODE_FILE_TYPE in its report.
test('the plugin folder holds no script, no package-manager file and none of the file kinds the portal restricts to Verified organizations', () => {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const packageFiles = /^(package(-lock)?\.json|npm-shrinkwrap\.json|pnpm-(lock|workspace)\.ya?ml|yarn\.lock|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|Pipfile(\.lock)?|poetry\.lock|uv\.lock|Gemfile(\.lock)?|\.npmrc|\.yarnrc(\.yml)?|bunfig\.toml|uv\.toml)$/i;
  for (const rel of files) {
    const name = path.basename(rel);
    const bytes = fs.readFileSync(path.join(dir, rel));
    assert.ok(!SCRIPT.test(name), `${rel} is a script, which the portal takes only from a Verified organization: ship it as Markdown`);
    assert.ok(!packageFiles.test(name), `${rel} is a package manager file`);
    assert.ok(!/^(claude|claude\.local|agents)\.md$/i.test(name), `${rel} is a file Claude Code reads as instructions`);
    assert.ok(!/[:\\<>"|?*]/.test(rel) && !/(^|\/)(con|prn|aux|nul|com\d|lpt\d)(\.|\/|$)/i.test(rel), `${rel} has a name not every computer keeps`);
    if (IMAGES.has(path.extname(rel).toLowerCase())) continue;
    assert.notEqual(bytes.subarray(0, 2).toString('latin1'), '#!', `${rel} starts with #!`);
    assert.ok(!bytes.includes(0), `${rel} holds a NUL byte`);
    assert.doesNotThrow(() => utf8.decode(bytes), `${rel} is not UTF-8`);
    // The portal blocked asset-check.mjs, the one file that held this literal, and takes an .svg only as the plugin icon. A script that checks SVG files writes the tag as a lookahead, /<(?=svg)/.
    assert.ok(!/<svg\b/i.test(bytes.toString('utf8')), `${rel} holds an SVG tag, which the portal can take for an SVG file under another name`);
    // A content sniffer (libmagic's `file`) calls any file with a line that starts `import x from 'y';` Java source, so the file is not text to it. The templates leave the semicolon off.
    assert.ok(!/^import [^\n]*;[ \t]*$/m.test(bytes.toString('utf8')), `${rel} has an import line that ends with a semicolon, which a content sniffer reads as Java source`);
  }
  const inManifestFolder = files.filter((rel) => rel.startsWith('.claude-plugin/'));
  assert.deepEqual(inManifestFolder, ['.claude-plugin/plugin.json'], 'only the manifest goes in .claude-plugin');
});

test('every call in the plugin form names the plugin by its manifest name', () => {
  const callForm = /\/([a-z0-9][a-z0-9-]*):100x\b/g;
  let seen = 0;
  for (const rel of files.filter((f) => f.endsWith('.md'))) {
    for (const [, prefix] of fs.readFileSync(path.join(dir, rel), 'utf8').matchAll(callForm)) {
      seen += 1;
      assert.equal(prefix, manifest.name, `${rel} calls /${prefix}:100x… but the plugin is ${manifest.name}`);
    }
  }
  assert.ok(seen >= 4, 'the README and the skills show how to call the plugin');
  assert.notEqual(manifest.name, '100x', 'the directory refuses 100x as a look-alike of loot, Loop and 1dox');
});

test('the icon is a square PNG of 512 to 2048 pixels under 2 MB, which the directory takes once, at the first submission', () => {
  assert.equal(manifest.icon, `./${ICON}`);
  const bytes = fs.readFileSync(path.join(dir, ICON));
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  assert.equal(width, height);
  assert.ok(width >= 512 && width <= 2048, `${width} px`);
  assert.ok(bytes.length < 2 * 1024 * 1024);
});

test('the README has at least 40 words outside code blocks, and the license is there', () => {
  const words = readme.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.ok(words >= LIMITS.minReadmeWords, `${words} words`);
  assert.ok(files.includes('LICENSE'));
  assert.equal(HAND_WRITTEN.every((rel) => files.includes(rel)), true);
});

test('the README names every way the skills leave the machine or change a permission', () => {
  const skills = files.filter((rel) => rel.startsWith('skills/') && rel.endsWith('.md')).map((rel) => fs.readFileSync(path.join(dir, rel), 'utf8')).join('\n');
  const mustSay = [
    [/bypassPermissions/, 'bypassPermissions'],
    [/@cursor\/sdk/, '@cursor/sdk'],
    [/100x browsers/, '100x browsers'],
    [/deploy\.preview|preview URL/, 'preview'],
    [/Never push to a remote/, 'never pushes to a remote'],
  ];
  for (const [inSkills, inReadme] of mustSay) if (inSkills.test(skills)) assert.ok(readme.includes(inReadme), `the skills say ${inSkills}, so the README must say "${inReadme}"`);
  // A shipped script that opens a connection is named in the README: the portal pairs a script that can send data off the machine with anything that reads a key.
  for (const rel of files.filter((f) => SCRIPT.test(f.replace(/\.md$/, '')) && f.endsWith('.md'))) {
    const script = path.basename(rel, '.md');
    if (/\bfetch\(/.test(scriptCode(fs.readFileSync(path.join(dir, rel), 'utf8')))) assert.ok(readme.includes(script), `${script} makes a request, so the README must name it`);
  }
});

test('standalone JavaScript templates ship as Markdown, and Python tools run from the CLI package', () => {
  const sources = listFiles(path.join(ROOT, 'skills')).filter((rel) => SCRIPT.test(rel) && !/^(project-mapper|new-scope|execute-scope|qa-scope)\//.test(rel));
  assert.ok(sources.length >= 6, 'the 100x skill carries its six templates');
  for (const rel of sources) {
    const copy = fs.readFileSync(path.join(dir, 'skills', `${rel}.md`), 'utf8');
    assert.equal(scriptCode(copy), fs.readFileSync(path.join(ROOT, 'skills', rel), 'utf8'), `${rel} and its Markdown copy hold different code`);
    assert.ok(copy.startsWith(`# ${path.basename(rel)}\n`) && copy.includes(`file named \`${path.basename(rel)}\``), `${rel} copy says which file to save the code as`);
    const skill = fs.readFileSync(path.join(dir, 'skills', rel.split('/')[0], 'SKILL.md'), 'utf8');
    assert.equal(skill.split('## In the Claude plugin').length - 1, 1, `${rel.split('/')[0]}/SKILL.md explains the .md copies once`);
  }
  const tricky = 'const a = `x`;\n// ```\nconst b = ````;\n';
  assert.equal(scriptCode(scriptAsMarkdown('t.mjs', tricky)), tricky, 'a script that holds backticks keeps its code, with a longer fence');
  assert.equal(scriptCode(scriptAsMarkdown('t.mjs', 'no newline')), 'no newline\n');
});

test('a rebuild repairs a plugin folder that holds a stale file, a deleted skill and an empty folder, and keeps the hand-written files', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), '100x-plugin-'));
  try {
    const put = (rel, text = 'x\n') => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    };
    put('package.json', JSON.stringify({ version: '1.2.3', license: 'MIT', repository: { url: 'git+https://github.com/o/r.git' }, keywords: ['k'] }));
    put('LICENSE');
    put('NOTICE.md');
    put('skills/kept/SKILL.md');
    const at = (rel) => path.join(root, PLUGIN_DIR, rel);
    put(`${PLUGIN_DIR}/README.md`, 'mine\n');
    put(`${PLUGIN_DIR}/${ICON}`, 'icon');
    put(`${PLUGIN_DIR}/skills/deleted/SKILL.md`);
    put(`${PLUGIN_DIR}/bin/tool`);
    assert.notDeepEqual(pluginProblems(root), []);

    buildPlugin(root);
    assert.deepEqual(pluginProblems(root), []);
    assert.ok(!fs.existsSync(at('bin')), 'the folder the stale file sat in is gone too');
    assert.ok(!fs.existsSync(at('skills/deleted')));
    assert.equal(fs.readFileSync(at('README.md'), 'utf8'), 'mine\n');
    assert.equal(fs.readFileSync(at(ICON), 'utf8'), 'icon');
    assert.equal(JSON.parse(fs.readFileSync(at('.claude-plugin/plugin.json'), 'utf8')).version, '1.2.3');
    assert.deepEqual(buildPlugin(root), { written: 0, removed: 0 }, 'a second build changes nothing');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('.gitattributes stays free of what makes the directory refuse to read the repository', () => {
  const text = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8').replace(/#.*$/gm, '');
  assert.ok(!/export-ignore|export-subst|\bfilter=/.test(text));
});
