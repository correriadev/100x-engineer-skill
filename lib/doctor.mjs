import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStamp } from './build-stamp.mjs';
import { checkVendored, treeHash, vendorDir } from './companions.mjs';
import { load } from './config.mjs';
import { sameModel } from './models.mjs';
import { readInfo } from './morning-server.mjs';
import { chromiumBuilds, INSTALL_HINT, resolvePlaywright } from './playwright.mjs';
import { globalDir, REPO_ROOT, skillsDir } from './paths.mjs';
import { recentHelpers, tally } from './provenance.mjs';
import { launcherState, usesLauncher } from './links.mjs';
import { isWindows } from './proc.mjs';
import { skillHash } from './skill-hash.mjs';
import { readManifest, staleLinks } from './install-record.mjs';
import { versionLine } from './version.mjs';
import { commandModels, hardCodesMax, isWindowName, lockedCommand, lockSelection, maxWindow, mayBeCursor, namesCursor, optionsSelection, outsideLock, parseOnly, sameId } from './helper-lock.mjs';
import { pythonRuntime, workbenchAvailable } from './workbench.mjs';

const INSTALL = 'Run `100x install`. From a clone that is not on your PATH yet, run scripts/install.sh in it.';

const isSkillCopy = (dir) => fs.lstatSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'SKILL.md'));

function linkState(target, expected) {
  // On Windows the 100x program is a launcher file (100x.cmd, and 100x for Git Bash) that runs node on the CLI entry.
  if (usesLauncher(expected)) {
    const { state } = launcherState(isWindows && !/\.cmd$/i.test(target) ? `${target}.cmd` : target, expected);
    return state === 'ok' ? 'ok' : state === 'missing' ? 'missing' : 'conflict';
  }
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return 'missing';
  }
  if (!stat.isSymbolicLink()) return 'conflict';
  try {
    return fs.realpathSync.native(target) === fs.realpathSync.native(expected) ? 'ok' : 'conflict';
  } catch {
    return 'broken';
  }
}

export function repoSkills(root = REPO_ROOT) {
  const dir = path.join(root, 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md'))).map((d) => d.name).sort();
}

export const formatCheck = (c) => `${c.status.padEnd(4)} ${c.name.padEnd(26)} ${c.detail}${c.fix && c.status !== 'ok' ? `\n${' '.repeat(31)}fix: ${c.fix}` : ''}`;

// What a person reads. A judge row that is not ok comes first, because it says whether a review can be trusted. Skill links that fail the same way with the same
// fix are one row. --json keeps every check.
export function presentChecks(checks) {
  const first = checks.filter((c) => (c.name === 'judge' || c.name === 'judge ran') && c.status !== 'ok');
  const groups = new Map();
  for (const c of checks) {
    if (first.includes(c) || !c.name.startsWith('skill ') || c.status === 'ok' || !c.fix) continue;
    const key = `${c.status}|${c.fix}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const folded = new Set([...groups.values()].filter((group) => group.length >= 3).flat());
  const rows = [];
  const done = new Set();
  for (const c of checks) {
    if (first.includes(c)) continue;
    if (!folded.has(c)) {
      rows.push(c);
      continue;
    }
    const key = `${c.status}|${c.fix}`;
    if (done.has(key)) continue;
    done.add(key);
    const group = groups.get(key);
    const words = [...new Set(group.map((member) => member.detail.split(' ').at(-1)))];
    rows.push({ status: c.status, name: 'skills', detail: `${group.length} skills ${words.length === 1 ? `show "${words[0]}"` : 'are not linked right'}: ${group.map((member) => member.name.slice('skill '.length)).join(', ')}`, fix: c.fix });
  }
  const count = (status) => [...first, ...rows].filter((c) => c.status === status).length;
  return { first, rows, tally: `${count('fail')} fail, ${count('warn')} warn, ${count('ok')} ok.` };
}

// On Windows a program is found by its name plus one of the extensions in PATHEXT.
const EXTENSIONS = isWindows ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
// `npm install -g` writes its own 100x.cmd that runs the bin of the package, which is this checkout when it was installed from here.
const npmShimRuns = (file) => {
  if (!isWindows) return false;
  try {
    return /bin[\\/]100x\.mjs/.test(fs.readFileSync(file, 'utf8')) && fs.realpathSync(path.join(path.dirname(file), 'node_modules', JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).name)) === fs.realpathSync(REPO_ROOT);
  } catch {
    return false;
  }
};

const onPathAs = (name) => (process.env.PATH ?? '').split(path.delimiter).some((entry) => entry && EXTENSIONS.some((ext) => fs.existsSync(path.join(entry, name + ext))));

// Who judges the finished work. Nothing vendor specific is built in, so an unset judge is a warning with the way out.
// A judge that is the model that builds shares its blind spots, so that is a warning too.
const SELF_REVIEW = ' It is also the model that builds, so its review is a self-review';
const SELF_REVIEW_FIX = 'Call 100x-setup and give the judge a model from another vendor than the builder, or run `100x config set review.model <model> --global`.';

export function judgeCheck(review, builderModel, only = null) {
  if (!review.enabled) return ['judge', 'ok', 'review is off in config'];
  const self = sameModel(review.model, builderModel);
  if (review.command) {
    const word = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(review.command);
    const program = word?.[1] ?? word?.[2] ?? word?.[3] ?? '';
    const found = !program || program.includes('$') || (/[\\/]/.test(program) ? fs.existsSync(program) : onPathAs(program));
    if (!found) return ['judge', 'warn', `${program} is not on PATH`, 'Install that tool, or call 100x-setup and change the judge.'];
    return ['judge', self ? 'warn' : 'ok', `a command, ${program}${review.model ? `, model ${review.model}` : ''}${self ? `.${SELF_REVIEW}` : ''}`, self ? SELF_REVIEW_FIX : ''];
  }
  if (review.model) return ['judge', self ? 'warn' : 'ok', `${review.model}${review.provider ? ` via ${review.provider}` : ''}, through the agent app's subagent tool${self ? `.${SELF_REVIEW}` : ''}`, self ? SELF_REVIEW_FIX : ''];
  if (only) {
    try {
      return ['judge', 'ok', `none named, so the locked selection, ${parseOnly(only).id}, through the SDK line of \`100x review-call\``];
    } catch {
      // a lock that does not parse has its own row
    }
  }
  return ['judge', 'warn', 'no judge chosen', 'Call 100x-setup. Until then the run asks the agent to pick a model from another vendor, or marks the project UNREVIEWED.'];
}

// The context window of every helper role. On Cursor every 1m window is a MAX mode variant, which a helper never starts in, and the account's
// default window for a model is a 1m one. So a role that asks for 1m, a command that hard-codes it, and a role that names no window where Cursor will
// pick one are told here, before the helper is needed. A 1m window is a fail, because nothing about it can start.
const windowValue = (options) => {
  const { window, windows, odd } = optionsSelection(options);
  return maxWindow(windows)?.window ?? (odd.length ? 'not text' : window ?? '');
};
const windowFix = (label, model) => `Run \`100x config role ${ROLE_OF[label] ?? label} --model ${model ?? '<model>'} --option contextWindow=300k --global\`.`;

export function windowCheck(label, { provider, model, options, command }) {
  const window = windowValue(options);
  const sdk = Boolean(command) && /\bhelper\s+run\b/.test(command);
  // A hard-coded 1m in the command is MAX mode on the SDK whatever the setting says, and with or without a model set.
  if (mayBeCursor(provider) && hardCodesMax(command)) return [`${label} window`, 'fail', `the ${label} command passes --context 1m, which is MAX mode on Cursor`, 'Run `100x config unset review.command --global` and set the SDK line from `100x ref apps`.'];
  if (!model && !sdk) return null;
  if (model && mayBeCursor(provider) && (maxWindow(optionsSelection(options).windows) || optionsSelection(options).odd.length)) return [`${label} window`, 'fail', `the ${label} setting asks for a ${window} context window, which is MAX mode on Cursor or not a size 100x can read`, windowFix(label, model)];
  if (sdk) {
    if (/--context[\s=]+["']?\d/i.test(command)) return null;
    // review-run turns the option contextWindow into $X100_OPT_CONTEXTWINDOW and the option context into $X100_OPT_CONTEXT, and no other.
    const key = Object.keys(options ?? {}).find((name) => isWindowName(name) && String(options[name] ?? '').trim());
    const wanted = (key ?? 'contextWindow').toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const named = [...command.matchAll(/X100_OPT_([A-Z0-9_]+)/g)].map((match) => match[1]);
    if (!named.includes(wanted)) return [`${label} window`, 'warn', named.some((name) => name.startsWith('CONTEXT')) ? `the ${label} command reads $X100_OPT_${named.find((name) => name.startsWith('CONTEXT'))}, and review-run sets $X100_OPT_${wanted} for this role, so it expands to nothing and \`100x helper run\` refuses it as MAX mode` : `the ${label} command never passes a context window, so \`100x helper run\` refuses it as MAX mode`, 'Add `${X100_OPT_CONTEXTWINDOW:+--context "$X100_OPT_CONTEXTWINDOW"}` to it, as `100x ref apps` shows.'];
    if (!window) return [`${label} window`, 'warn', `the ${label} command takes its window from the setting, and the setting has none, so \`100x helper run\` refuses it as MAX mode`, windowFix(label, model)];
    return null;
  }
  if (window) return null;
  if (namesCursor(provider)) return [`${label} window`, 'warn', `the ${label} setting names no context window on provider cursor, and Cursor's default window for a model is a 1m MAX mode one`, windowFix(label, model)];
  return null;
}

const ROLE_OF = { judge: 'review', 'fallback judge': 'fallback', overnight: 'overnight' };

// A judge or an overnight child that the lock would refuse never starts, so say so before it is needed. The quick jobs and the builder are the thread's own model.
export function lockCheck(label, { provider, model, options, command }, only) {
  if (!only) return null;
  let outside = null;
  let named = null;
  try {
    outside = model ? outsideLock({ providerInstanceId: provider || undefined, model, options }, only) : null;
    named = command ? commandModels(command).find((id) => !sameId(id, lockSelection(only).id)) : null;
  } catch {
    return null; // a lock that does not parse has its own row
  }
  if (named) return [`${label} lock`, 'fail', `the ${label} command names the model ${named} itself, and helpers on this machine are locked to ${lockSelection(only).id}`, 'Let the command read $X100_MODEL, as `100x ref apps` shows, or run `100x config unset review.command --global`.'];
  return outside ? [`${label} lock`, 'fail', `the ${label} ${outside}`, `Run \`${lockedCommand(ROLE_OF[label] ?? '<role>', only)}\`, or lift the lock with \`100x config unset helper.only --global\`.`] : null;
}

export function windowChecks(effective) {
  const { review } = effective;
  // A judge that is switched off never starts, so its window is nobody's problem. Overnight and quick children start whatever the review setting says.
  const judges = review.enabled === false ? [] : [
    ['judge', { provider: review.provider, model: review.model, options: review.options, command: review.command }],
    ['fallback judge', { provider: review.provider, model: review.fallbackModel, options: review.fallbackOptions, command: review.fallbackModel ? review.command : null }],
  ];
  const roles = [...judges, ['overnight', effective.overnight], ['quick', effective.quick]];
  const locked = roles.filter(([label]) => label !== 'quick').map(([label, role]) => lockCheck(label, role, effective.helper?.only));
  return [...roles.map(([label, role]) => windowCheck(label, role)), ...locked].filter(Boolean);
}

const HELPERS_SHOWN = 20;

// The app's own record of the helpers it started, when it keeps one. An app can run another model than the one it was asked for,
// and a run of helpers that never match the judge setting says the setting is not what runs.
export function helperCheck(review, helpers = recentHelpers({ hours: 24 })) {
  if (!review.enabled || review.command || !review.model) return null;
  if (!helpers.length) return null;
  const latest = helpers.slice(-HELPERS_SHOWN);
  const ran = tally(latest);
  const listed = `the app's hooks log lists ${helpers.length} helper${helpers.length === 1 ? '' : 's'} from the last 24 hours${helpers.length > latest.length ? `, and the last ${latest.length} are counted here` : ''}: ${ran}`;
  if (latest.some((helper) => sameModel(helper.model, review.model))) return ['judge ran', 'ok', listed];
  return ['judge ran', 'warn', `${listed}. None ran ${review.model}, the judge setting, so the app may be ignoring the model`, 'Start the judge as a command (review.command, see skills/100x/references/apps.md) or in an app that honors the model, and run `100x review-verify` after each judge.'];
}

export async function runDoctor({ deep = false } = {}) {
  const checks = [];
  const add = (name, status, detail, fix = '') => checks.push({ name, status, detail, fix });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 22 ? 'ok' : 'fail', `v${process.versions.node}`, major >= 22 ? '' : 'Install Node 22 or newer.');
  add('100x', 'ok', versionLine());
  const runtime = pythonRuntime();
  add('engineering runtime', runtime ? 'ok' : 'warn', runtime ? `Python ${runtime.python.join('.')} with SQLite ${runtime.sqlite.join('.')}` : 'Python 3.12+ with SQLite 3.37+ is unavailable; engineering tools cannot run', runtime ? '' : 'Install Python 3.12+ with SQLite 3.37+, or set X100_PYTHON to its executable. Other 100x modes do not need Python.');
  const missingWorkbench = ['mapper', 'scope', 'execute', 'qa'].filter((name) => !workbenchAvailable(name));
  add('engineering package', missingWorkbench.length ? 'fail' : 'ok', missingWorkbench.length ? `missing ${missingWorkbench.join(', ')}` : 'mapping and contract programs are present', missingWorkbench.length ? 'Update or reinstall the 100x package.' : '');

  const home = globalDir();
  if (!fs.existsSync(home)) {
    add('home', 'fail', `${home} is missing`, INSTALL);
  } else {
    add('home', 'ok', home);
    const bin = linkState(path.join(home, 'bin', '100x'), path.join(REPO_ROOT, 'bin', '100x.mjs'));
    add('cli link', bin === 'ok' ? 'ok' : bin === 'missing' ? 'warn' : 'fail', `${path.join(home, 'bin', '100x')} is ${bin}`, bin === 'ok' ? '' : INSTALL);
    const onPath = (process.env.PATH ?? '').split(path.delimiter).some((entry) => entry && (linkState(path.join(entry, '100x'), path.join(REPO_ROOT, 'bin', '100x.mjs')) === 'ok' || npmShimRuns(path.join(entry, '100x.cmd'))));
    add('on PATH', onPath ? 'ok' : 'warn', onPath ? '`100x` resolves in this shell' : '`100x` is not on PATH in this shell', onPath ? '' : `Call ${path.join(home, 'bin', isWindows ? '100x.cmd' : '100x')}, or put ${isWindows ? path.join(os.homedir(), '.local', 'bin') : '~/.local/bin'} on PATH.`);
    add('profile', fs.existsSync(path.join(home, 'profile.md')) ? 'ok' : 'warn', path.join(home, 'profile.md'), 'Run `100x install`. It writes a default profile.');
    // An older install may have linked a skill that this repo has since dropped. The link is dead and the agent reads the folder it sits in.
    const record = path.join(home, 'install.json');
    const recorded = readManifest(home);
    if (fs.existsSync(record) && !recorded) add('install record', 'warn', `${record} is damaged`, 'Run `100x install`. It writes a new one.');
    const stale = staleLinks(recorded, fs.realpathSync(REPO_ROOT));
    if (stale.length) add('old links', 'warn', `${stale.map((l) => l.path).join(', ')} point${stale.length === 1 ? 's' : ''} at a skill this repo no longer ships`, 'Run `100x install`. It removes the link and puts back the one you had made.');
    // A gallery server keeps the code it started with. One from an older build serves the old page and says "already running" to the new one.
    const server = readInfo();
    if (server) {
      const current = server.build === buildStamp();
      const since = new Date(server.startedAt);
      const date = Number.isNaN(since.getTime()) ? '' : ` since ${since.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      add('gallery server', current ? 'ok' : 'fail', current ? `running${date}, the build on disk` : `running${date}, from an older 100x, so it still shows the old page`, current ? '' : 'Call `100x-report`. It restarts the gallery with the new page, or says what to stop first.');
    }
  }

  try {
    const loaded = load();
    const errors = loaded.problems.filter((p) => p.level === 'error');
    const warns = loaded.problems.filter((p) => p.level === 'warn');
    add('config', errors.length ? 'fail' : warns.length ? 'warn' : 'ok', errors.length || warns.length ? [...errors, ...warns].map((p) => `${p.path} ${p.message}`).join('; ') : `polish ${loaded.effective.polish.passes}, variants ${loaded.effective.variants.parallel ? 'in parallel' : 'one at a time'}, at most ${loaded.effective.subagents.atOnce} helpers at once`, errors.length ? 'Fix the file or run `100x config unset <path> --global`.' : '');
    add(...judgeCheck(loaded.effective.review, loaded.effective.builder.model, loaded.effective.helper.only));
    for (const row of windowChecks(loaded.effective)) add(...row);
    const { only, ceiling } = loaded.effective.helper;
    let lockParses = true;
    if (only) {
      try {
        parseOnly(only);
      } catch (error) {
        lockParses = false;
        add('helper limits', 'fail', error.message, 'Run `100x config set helper.only "<model id> <parameter>=<value> ..." --global`, or `100x config unset helper.only --global`.');
      }
    }
    if (lockParses && (only || ceiling)) add('helper limits', 'ok', [only ? `every helper is locked to ${only}` : null, ceiling ? `a ceiling of ${ceiling} on the helpers a night or a run asks for at once, which does not count judges or the thread itself` : null].filter(Boolean).join(', '));
    const ran = helperCheck(loaded.effective.review);
    if (ran) add(...ran);
  } catch (error) {
    add('config', 'fail', error.message, 'Fix the JSON or delete the file.');
  }

  const skills = skillsDir();
  for (const name of repoSkills()) {
    const dir = path.join(skills, name);
    const source = path.join(REPO_ROOT, 'skills', name);
    const state = linkState(dir, source);
    if (state === 'conflict' && isSkillCopy(dir)) {
      // A copy from `npx skills add` is an install. It is the right one only while it holds the files of this checkout, because the CLI is this checkout.
      const same = skillHash(dir) === skillHash(source);
      add(`skill ${name}`, same ? 'ok' : 'warn', `${dir} is a copy${same ? ', the same files as this checkout' : ' that differs from this checkout'}`, same ? '' : 'Run `npx skills update -g`, or remove the copy and run `100x install` to link this checkout.');
      continue;
    }
    add(`skill ${name}`, state === 'ok' ? 'ok' : state === 'missing' ? 'warn' : 'fail', `${dir} is ${state}`, state === 'ok' ? '' : INSTALL);
  }
  // The pinned copy in vendor/ is what `100x text` runs. The linked skill folder is what agents read.
  for (const result of checkVendored()) {
    add(result.name, result.ok ? 'ok' : 'fail', result.ok ? `pinned copy ${result.version ?? ''} at ${result.commit}`.replace('  ', ' ') : result.problem);
    const dir = path.join(skills, result.name);
    const present = fs.existsSync(path.join(dir, 'SKILL.md'));
    const same = linkState(dir, vendorDir(result.name)) === 'ok';
    // A checkout is fine while it is the same build as the pinned copy. When it differs, an agent that follows the companion's own
    // instructions runs one build, and `100x text` another.
    const sameBuild = present && (same || treeHash(dir) === treeHash(vendorDir(result.name)));
    add(`skill ${result.name}`, present ? (sameBuild ? 'ok' : 'warn') : 'warn', present ? `${dir}${same ? '' : sameBuild ? ' (a checkout, the same build as the pinned copy)' : ' (a checkout that differs from the pinned copy)'}` : `${dir} not found`, present ? (sameBuild ? '' : `\`100x text\` runs the pinned copy and an agent that follows the skill runs this checkout, so the two can behave differently. Run node scripts/vendor-companions.mjs to pin the checkout, or \`100x install --force\` to link the pinned copy.`) : INSTALL);
  }

  const pw = resolvePlaywright();
  if (!pw) {
    add('playwright', 'warn', 'not found', INSTALL_HINT);
  } else {
    add('playwright', 'ok', `${pw.version} via ${pw.base}`);
    const builds = chromiumBuilds();
    add('chromium', builds.length ? 'ok' : 'warn', builds.length ? builds.join(', ') : 'no chromium build in the browser cache', builds.length ? '' : INSTALL_HINT);
    if (deep) {
      try {
        const browser = await pw.playwright.chromium.launch();
        const page = await browser.newPage();
        await page.setContent('<p>ok</p>');
        await browser.close();
        add('browser launch', 'ok', 'headless chromium rendered a page');
      } catch (error) {
        add('browser launch', 'fail', error.message.split('\n')[0], INSTALL_HINT);
      }
    }
  }
  return checks;
}
