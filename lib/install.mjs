import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vendorDir } from './companions.mjs';
import { repoSkills } from './doctor.mjs';
import { CliError } from './errors.mjs';
import { launcherState, makeLink, usesLauncher, writeLauncher } from './links.mjs';
import { globalDir, REPO_ROOT, skillsDir } from './paths.mjs';
import { isWindows } from './proc.mjs';
import { skillHash } from './skill-hash.mjs';
import { MANIFEST, readManifest, staleLinks } from './install-record.mjs';

export const UNSLOP_SKILLS = ['unslop-text'];
// Extra skill folders for apps that do not read ~/.agents/skills. Paths are the ones each app documents.
export const APP_SKILL_DIRS = { claude: ['.claude', 'skills'], codex: ['.codex', 'skills'], opencode: ['.config', 'opencode', 'skills'], cursor: ['.cursor', 'skills'] };
export const APP_NAMES = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', cursor: 'Cursor' };

// The apps whose folder is already on this machine. They read their own skills folder, so a default install does not reach them.
export const appsHere = (home = os.homedir()) => Object.entries(APP_SKILL_DIRS).filter(([, parts]) => fs.existsSync(path.join(home, ...parts.slice(0, -1)))).map(([app]) => app);

// Windows paths differ by case and by a closing backslash that a junction keeps, and both name the same folder.
const sameFolderPath = (a, b) => (isWindows ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const canonical = (p) => (fs.existsSync(p) ? fs.realpathSync.native(p) : path.resolve(p));
const lstat = (p) => {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
};

export function linkStatus(linkPath, target) {
  // On Windows the 100x program is a launcher file, not a link, because only an .exe, .cmd or script is run by its name.
  if (usesLauncher(target)) return launcherState(linkPath, target);
  const stat = lstat(linkPath);
  if (!stat) return { state: 'missing' };
  if (!stat.isSymbolicLink()) {
    // `npx skills add` (skills.sh) installs a skill as a copy of its folder. That is an install, not something in the way.
    if (stat.isDirectory() && fs.existsSync(path.join(linkPath, 'SKILL.md')) && fs.existsSync(path.join(target, 'SKILL.md'))) return { state: 'copy', same: skillHash(linkPath) === skillHash(target) };
    return { state: 'blocked', current: stat.isDirectory() ? 'a real folder' : 'a real file' };
  }
  const current = fs.readlinkSync(linkPath);
  const resolved = path.resolve(path.dirname(linkPath), current);
  const same = canonical(linkPath) === canonical(target) || sameFolderPath(resolved, target);
  return { state: same ? 'ok' : 'elsewhere', current: resolved };
}

function resolveOptions(options) {
  const repo = canonical(options.repo ?? REPO_ROOT);
  const home = path.resolve(options.home ?? globalDir());
  return {
    repo,
    home,
    skills: path.resolve(options.skills ?? skillsDir()),
    also: (options.also ?? []).map((app) => {
      if (!APP_SKILL_DIRS[app]) throw new CliError(`Unknown app "${app}". Choose from ${Object.keys(APP_SKILL_DIRS).join(', ')}.`);
      return path.join(os.homedir(), ...APP_SKILL_DIRS[app]);
    }),
    binDir: options.binDir === false ? null : path.resolve(options.binDir ?? path.join(os.homedir(), '.local', 'bin')),
    unslop: options.unslop === false ? null : { 'unslop-text': options.unslopText },
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun),
  };
}

function onPath(dir) {
  return (process.env.PATH ?? '').split(path.delimiter).some((entry) => entry && canonical(entry) === canonical(dir));
}

export function install(options = {}) {
  const o = resolveOptions(options);
  const manifestFile = path.join(o.home, MANIFEST);
  if (lstat(manifestFile)?.isSymbolicLink()) {
    const events = [{ kind: 'manifest', status: 'blocked', path: manifestFile, detail: 'is a symlink, so the install record would be written through it into another file. Remove the link and run again' }];
    return { ok: false, dryRun: o.dryRun, home: o.home, skills: o.skills, repo: o.repo, events };
  }
  const previous = readManifest(o.home);
  const manifest = { version: 1, repo: o.repo, installedAt: new Date().toISOString(), links: [], files: [], dirs: previous?.dirs ?? [] };
  const events = [];
  let ok = true;

  const note = (kind, status, target, detail = '', how = 'symlink') => events.push({ kind, status, path: target, detail, ...(how === 'symlink' ? {} : { how }) });

  function ensureDir(dir) {
    if (fs.existsSync(dir)) return;
    if (!o.dryRun) fs.mkdirSync(dir, { recursive: true });
    manifest.dirs = manifest.dirs.filter((d) => d !== dir).concat(dir);
    note('dir', o.dryRun ? 'would create' : 'created', dir);
  }

  function link(linkPath, target, { core = true } = {}) {
    const status = linkStatus(linkPath, target);
    const previousRecord = previous?.links.find((l) => l.path === linkPath);
    if (status.state === 'ok') {
      manifest.links.push({ path: linkPath, target, ...(previousRecord?.replaced ? { replaced: previousRecord.replaced } : {}) });
      return note('link', 'unchanged', linkPath, target);
    }
    if (status.state === 'copy') {
      if (!status.same && core) ok = false;
      return note('link', 'present', linkPath, status.same ? 'a copy of this skill, such as `npx skills add` makes, with the same files as this checkout' : 'a copy that differs from this checkout. Refresh it with `npx skills update -g`, or remove it and run again to link this checkout');
    }
    if (status.state === 'blocked') {
      if (core) ok = false;
      return note('link', 'blocked', linkPath, `${status.current} is already there and was left alone`);
    }
    if (status.state === 'elsewhere' && !o.force) {
      if (core) ok = false;
      return note('link', 'conflict', linkPath, `already points to ${status.current}. Run again with --force to replace it`);
    }
    const launcher = usesLauncher(target);
    // A launcher that ran another 100x is overwritten, and there is no earlier link to give back on uninstall.
    const replaced = status.state === 'elsewhere' && !launcher ? status.current : undefined;
    let how = launcher ? 'launcher' : 'symlink';
    if (!o.dryRun) {
      fs.mkdirSync(path.dirname(linkPath), { recursive: true });
      if (status.state === 'elsewhere' && !launcher) fs.unlinkSync(linkPath);
      if (launcher) writeLauncher(linkPath, target);
      else how = makeLink(target, linkPath);
    }
    manifest.links.push({ path: linkPath, target, ...(replaced ? { replaced } : {}) });
    note('link', o.dryRun ? 'would link' : status.state === 'elsewhere' ? 'replaced' : 'created', linkPath, how === 'symlink' ? target : `${target}  (${how})`, how);
  }

  // The 100x program. On Windows that is two launchers, 100x.cmd for cmd and PowerShell and 100x for Git Bash, each running node on the CLI entry.
  function program(linkPath, unixTarget, opts) {
    if (!isWindows) return link(linkPath, unixTarget, opts);
    const entry = path.join(o.repo, 'bin', '100x.mjs');
    link(linkPath, entry, opts);
    return link(`${linkPath}.cmd`, entry, opts);
  }

  function file(filePath, content, { overwrite }) {
    if (lstat(filePath)?.isSymbolicLink()) return note('file', 'kept', filePath, 'is a symlink, so nothing is written through it');
    const exists = fs.existsSync(filePath);
    const wanted = sha256(content);
    const previousRecord = previous?.files.find((f) => f.path === filePath);
    if (exists) {
      const current = fs.readFileSync(filePath, 'utf8');
      if (current === content) {
        manifest.files.push({ path: filePath, sha256: wanted });
        return note('file', 'unchanged', filePath);
      }
      if (!overwrite) {
        if (previousRecord) manifest.files.push(previousRecord);
        return note('file', 'kept', filePath, 'already exists and was left alone');
      }
    }
    if (!o.dryRun) fs.writeFileSync(filePath, content);
    manifest.files.push({ path: filePath, sha256: wanted });
    note('file', o.dryRun ? 'would write' : exists ? 'updated' : 'created', filePath);
  }

  ensureDir(o.home);
  ensureDir(path.join(o.home, 'bin'));
  const skillDirs = [...new Set([o.skills, ...o.also])];
  for (const dir of skillDirs) ensureDir(dir);

  program(path.join(o.home, 'bin', '100x'), path.join(o.repo, 'bin', '100x.mjs'));
  if (o.binDir) {
    ensureDir(o.binDir);
    program(path.join(o.binDir, '100x'), path.join(o.home, 'bin', '100x'), { core: false });
    if (!onPath(o.binDir)) note('path', 'hint', o.binDir, isWindows ? `is not on PATH. Add it in Windows Settings (search for "environment variables"), or call ${path.join(o.home, 'bin', '100x.cmd')}` : `is not on PATH. Add it, or call ${path.join(o.home, 'bin', '100x')}`);
  }

  file(path.join(o.home, 'repo'), `${o.repo}\n`, { overwrite: true });
  file(path.join(o.home, 'config.json'), '{}\n', { overwrite: false });
  const profileDefault = path.join(o.repo, 'skills', '100x', 'references', 'profile.default.md');
  if (fs.existsSync(profileDefault)) file(path.join(o.home, 'profile.md'), fs.readFileSync(profileDefault, 'utf8'), { overwrite: false });

  for (const dir of skillDirs) for (const name of repoSkills(o.repo)) link(path.join(dir, name), path.join(o.repo, 'skills', name), { core: dir === o.skills });

  // unslop-text comes pinned inside this repository (vendor/). A checkout you point at wins, and a link
  // you already made to your own copy is left alone unless --force asks for the pinned one.
  if (o.unslop) {
    for (const name of UNSLOP_SKILLS) {
      const explicit = o.unslop[name];
      const source = explicit ? path.join(path.resolve(explicit), 'skills', name) : vendorDir(name, o.repo);
      if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
        note('link', 'missing', path.join(o.skills, name), explicit ? `${path.resolve(explicit)} has no skills/${name}/SKILL.md` : `vendor/${name} is missing from this checkout. Run node scripts/vendor-companions.mjs`);
        continue;
      }
      for (const dir of skillDirs) {
        const linkPath = path.join(dir, name);
        const status = linkStatus(linkPath, source);
        if (!explicit && !o.force && status.state === 'elsewhere' && fs.existsSync(path.join(status.current, 'SKILL.md'))) {
          note('link', 'kept', linkPath, `points to ${status.current}, a copy of ${name} you chose. Run again with --force to use the pinned one in vendor/`);
          continue;
        }
        link(linkPath, source, { core: false });
      }
    }
  }

  // A skill this repo no longer has (it was renamed, or it left vendor/) leaves a link that points at a folder which is gone. Take that
  // link out, and give back the link the owner had made before 100x replaced it.
  const currentTargets = new Set(manifest.links.map((l) => path.resolve(l.target)));
  for (const old of staleLinks(previous, o.repo)) {
    const target = path.resolve(old.target);
    if (currentTargets.has(target)) continue;
    const restore = old.replaced && fs.existsSync(old.replaced) ? old.replaced : null;
    if (!o.dryRun) {
      fs.unlinkSync(old.path);
      if (restore) makeLink(restore, old.path);
    }
    note('link', o.dryRun ? 'would remove' : 'removed', old.path, `the skill it pointed at, ${target}, is no longer in this repo${restore ? `. Restored the link you had made, to ${restore}` : ''}`);
  }

  const carried = (previous?.links ?? []).filter((l) => !manifest.links.some((m) => m.path === l.path) && linkStatus(l.path, l.target).state === 'ok');
  manifest.links.push(...carried);
  manifest.files = manifest.files.filter((f, i, all) => all.findIndex((g) => g.path === f.path) === i);
  if (!o.dryRun) fs.writeFileSync(path.join(o.home, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return { ok, dryRun: o.dryRun, home: o.home, skills: o.skills, repo: o.repo, events };
}

export function uninstall(options = {}) {
  const o = resolveOptions(options);
  const manifest = readManifest(o.home);
  const events = [];
  if (!manifest) return { ok: true, dryRun: o.dryRun, home: o.home, events: [{ kind: 'manifest', status: 'none', path: path.join(o.home, MANIFEST), detail: 'nothing to remove, this install is not recorded' }] };
  const note = (kind, status, target, detail = '') => events.push({ kind, status, path: target, detail });
  const removed = new Set();

  for (const record of [...manifest.links].reverse()) {
    const status = linkStatus(record.path, record.target);
    if (status.state === 'missing') {
      note('link', 'gone', record.path);
    } else if (status.state !== 'ok') {
      note('link', 'kept', record.path, 'was changed after the install and was left alone');
    } else {
      if (!o.dryRun) {
        fs.unlinkSync(record.path);
        if (record.replaced) makeLink(record.replaced, record.path);
      }
      if (!record.replaced) removed.add(record.path);
      note('link', o.dryRun ? 'would remove' : 'removed', record.path, record.replaced ? `restored the link to ${record.replaced}` : '');
    }
  }
  for (const record of manifest.files) {
    if (!fs.existsSync(record.path)) {
      note('file', 'gone', record.path);
    } else if (sha256(fs.readFileSync(record.path, 'utf8')) !== record.sha256) {
      note('file', 'kept', record.path, 'you edited it, so it stays');
    } else {
      if (!o.dryRun) fs.unlinkSync(record.path);
      removed.add(record.path);
      note('file', o.dryRun ? 'would remove' : 'removed', record.path);
    }
  }
  if (!o.dryRun) fs.unlinkSync(path.join(o.home, MANIFEST));
  removed.add(path.join(o.home, MANIFEST));
  for (const dir of [...manifest.dirs].reverse()) {
    if (!fs.existsSync(dir)) continue;
    const remaining = fs.readdirSync(dir).filter((name) => !removed.has(path.join(dir, name)));
    if (remaining.length) {
      note('dir', 'kept', dir, 'still holds your data or other tools');
      continue;
    }
    if (!o.dryRun) fs.rmdirSync(dir);
    removed.add(dir);
    note('dir', o.dryRun ? 'would remove' : 'removed', dir);
  }
  return { ok: true, dryRun: o.dryRun, home: o.home, events };
}
