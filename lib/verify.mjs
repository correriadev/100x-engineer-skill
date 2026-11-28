import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cell, timestamp } from './decisions.mjs';
import { git } from './git.mjs';

// The verification ledger. It lives in the project, next to the code and tracked by git, so it travels with every branch.
//   verify/ledger.tsv    what is claimed now: one row per property, with the code it covers and a hash of that code
//   verify/history.tsv   every add, run, sync, amend and retire, appended and never rewritten, like the decisions log
//   verify/red/<id>.txt  the failing run on a seeded defect. A property that never failed proves nothing
export const KINDS = ['state', 'transition', 'precondition', 'postcondition', 'invariant', 'liveness'];
export const LEVELS = ['exhaustive', 'bounded', 'sampled'];
export const LEDGER_COLUMNS = ['id', 'kind', 'property', 'covers', 'covers_hash', 'command', 'level', 'red', 'status', 'checked_at', 'commit', 'ran_hash'];
export const HISTORY_COLUMNS = ['ts', 'id', 'event', 'commit', 'hash', 'note', 'result'];
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '.100x', '.project-mapper', '.pytest_cache', '__pycache__', 'dist', 'build', 'coverage', '.next', 'vendor']);
const HASH_SKIP_DIRS = new Set(['.git', '.100x', '.project-mapper']);
const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|kt|swift|rb|c|cc|cpp|h|hpp|cs|php|lua|gd|scala|ex|exs|clj|dart|zig)$/i;
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|spec|specs|e2e|fixtures)\/|\.(?:test|spec)\.[a-z]+$|(?:^|\/)[^/]*\.config\.[a-z]+$/i;

export const ledgerDir = (root) => path.join(root, 'verify');
export const ledgerFile = (root) => path.join(ledgerDir(root), 'ledger.tsv');
export const historyFile = (root) => path.join(ledgerDir(root), 'history.tsv');
export const redFile = (root, id) => path.join(ledgerDir(root), 'red', id + '.txt');
const short = (hash) => (hash ?? '').slice(0, 16);
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function readTsv(file, columns) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1);
  return lines.map((line) => { const cells = line.split('\t'); return Object.fromEntries(columns.map((name, index) => [name, cells[index] ?? ''])); });
}
export const readLedger = (root) => readTsv(ledgerFile(root), LEDGER_COLUMNS);
export const readHistory = (root) => readTsv(historyFile(root), HISTORY_COLUMNS);
export function writeLedger(root, rows) {
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  const body = rows.map((row) => LEDGER_COLUMNS.map((name) => cell(row[name])).join('\t'));
  fs.writeFileSync(ledgerFile(root), [LEDGER_COLUMNS.join('\t'), ...body].join('\n') + '\n');
}
export function appendHistory(root, row, now = new Date()) {
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  const file = historyFile(root);
  const fresh = !fs.existsSync(file) || fs.statSync(file).size === 0;
  const line = [timestamp(now), row.id, row.event, row.commit ?? '', row.hash ?? '', row.note ?? '', row.result ?? ''].map(cell).join('\t');
  fs.appendFileSync(file, (fresh ? HISTORY_COLUMNS.join('\t') + '\n' : '') + line + '\n');
}

export const headShort = (root) => git(root, ['rev-parse', '--short', 'HEAD']) ?? 'no-commit';
export const splitCovers = (text) => String(text ?? '').split(',').map((part) => part.trim().replace(/^\.\//, '').replace(/\/+$/, '')).filter(Boolean);

function walk(root, entry, out, links = []) {
  const parts = entry.split(/[\\/]/);
  if (path.isAbsolute(entry) || parts.includes('..')) return false;
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) { links.push(entry); return fs.existsSync(current); } } catch { return false; }
  }
  const full = path.join(root, entry);
  let stat;
  try { stat = fs.lstatSync(full); } catch { return false; }
  // A link is not followed: a loop would walk the same folder again, and a link out of the project is not this project's code.
  if (stat.isSymbolicLink()) { links.push(entry); return fs.existsSync(full); }
  if (stat.isFile()) { out.push(entry); return true; }
  if (!stat.isDirectory()) return false;
  for (const name of fs.readdirSync(full).sort()) {
    if (HASH_SKIP_DIRS.has(name)) continue;
    walk(root, entry + '/' + name, out, links);
  }
  return true;
}

// A hash of what the property covers: every file's path and bytes. Any edit to covered code changes it.
export function hashCovers(root, covers) {
  const files = [];
  const links = [];
  const missing = [];
  for (const entry of covers) if (!walk(root, entry, files, links)) missing.push(entry);
  const hash = crypto.createHash('sha256');
  for (const file of [...new Set(files)].sort()) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  return { hash: short(hash.digest('hex')), files: files.length, missing, links };
}

export function redProof(root, id, named) {
  const file = named && !path.isAbsolute(named) && !named.split('/').includes('..') ? path.join(root, named) : redFile(root, id);
  if (!fs.existsSync(file)) return { ok: false, why: 'no failing run in ' + rel(root, file) + '. Seed one defect in a throwaway copy of the covered code, run the check, and save the failing output there' };
  const text = fs.readFileSync(file, 'utf8');
  if (!/^FAIL\s+\S/m.test(text)) return { ok: false, why: rel(root, file) + ' has no FAIL line, so it does not show the check failing' };
  return { ok: true };
}

// holds: green, current, and it has failed on a seeded defect. Everything else needs work.
// broken: the last run failed. stale: the covered code changed since the last sync, or a covered file is gone.
// unproven: green but no failing run on file. unchecked: never run. waived: a recorded decision that this code has no property.
export function rowState(root, row) {
  const now = hashCovers(root, splitCovers(row.covers));
  if (now.links.length) return { state: 'stale', why: 'covered paths contain symlinks that cannot be verified: ' + now.links.join(', ') };
  if (row.kind === 'waived') {
    if (now.missing.length || now.hash !== row.covers_hash) return { state: 'stale', why: 'the waived content changed or disappeared; reassess the waiver' };
    return { state: 'waived', why: row.property };
  }
  if (row.status === 'broken') return { state: 'broken', why: 'the last run failed at ' + row.commit };
  if (now.missing.length) return { state: 'stale', why: 'covered path is gone: ' + now.missing.join(', ') };
  if (now.hash !== row.covers_hash) return { state: 'stale', why: 'the covered code changed after the last sync. Read what changed, run the check, then sync' };
  if (row.status !== 'holds') return { state: 'unchecked', why: 'never run' };
  const red = redProof(root, row.id, row.red);
  if (!red.ok) return { state: 'unproven', why: red.why };
  return { state: 'holds', why: '' };
}

export function checkRow(root, row) {
  const errors = [];
  if (!ID.test(row.id ?? '')) errors.push('id must be lowercase words joined by hyphens');
  if (!KINDS.includes(row.kind)) errors.push('kind must be one of ' + KINDS.join(', '));
  if (!String(row.property ?? '').trim() || String(row.property).trim().length < 12) errors.push('property must be one plain sentence that says what always holds');
  if (!LEVELS.includes(row.level)) errors.push('level must be one of ' + LEVELS.join(', ') + '. Say what the check really does: exhaustive visits every state of the model, bounded stopped at a limit, sampled is random cases');
  if (!String(row.command ?? '').trim()) errors.push('command is missing. It runs from the project root and exits 0 when the property holds');
  const covers = splitCovers(row.covers);
  if (!covers.length) errors.push('covers is missing. List the files or folders whose code the property is about');
  const gone = covers.filter((entry) => !fs.existsSync(path.join(root, entry)));
  if (gone.length) errors.push('covers names paths that do not exist: ' + gone.join(', '));
  if (covers.some((entry) => path.isAbsolute(entry) || entry.split('/').includes('..'))) errors.push('covers must stay inside the project');
  else if (hashCovers(root, covers).links.length) errors.push('covers contains symlinks. Select real project paths instead');
  return errors;
}

export function addRow(root, fields, now = new Date()) {
  const rows = readLedger(root);
  const row = { id: fields.id, kind: fields.kind, property: String(fields.property ?? '').trim(), covers: splitCovers(fields.covers).join(','), command: String(fields.command ?? '').trim(), level: fields.level, red: 'verify/red/' + fields.id + '.txt', status: 'unchecked', checked_at: '', commit: '', ran_hash: '' };
  const errors = checkRow(root, row);
  if (rows.some((existing) => existing.id === row.id)) errors.push('the id ' + row.id + ' is already in the ledger. Amend it, or pick another id');
  if (errors.length) return { errors };
  row.covers_hash = hashCovers(root, splitCovers(row.covers)).hash;
  rows.push(row);
  writeLedger(root, rows);
  appendHistory(root, { id: row.id, event: 'add', commit: headShort(root), hash: row.covers_hash, note: row.property, result: 'unchecked' }, now);
  return { errors: [], row };
}

export function waive(root, paths, why, now = new Date()) {
  const rows = readLedger(root);
  const reason = String(why ?? '').trim();
  if (reason.length < 12) return { errors: ['--why must say, in a sentence, why no property can be written for this code'] };
  const added = [];
  const entries = paths.flatMap(splitCovers);
  for (const entry of entries) {
    if (path.isAbsolute(entry) || entry.split('/').includes('..')) return { errors: ['waived paths must stay inside the project'] };
    if (!fs.existsSync(path.join(root, entry))) return { errors: ['no such path: ' + entry] };
    if (hashCovers(root, [entry]).links.length) return { errors: ['waived paths contain symlinks. Select real project paths instead: ' + entry] };
  }
  for (const entry of entries) {
    let id = 'waived-' + entry.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
    const existing = rows.find((row) => row.kind === 'waived' && row.covers === entry);
    if (existing) {
      if (rowState(root, existing).state === 'stale') {
        Object.assign(existing, { property: reason, covers_hash: hashCovers(root, [entry]).hash, checked_at: timestamp(now), commit: headShort(root) });
        appendHistory(root, { id: existing.id, event: 'reassess', commit: existing.commit, hash: existing.covers_hash, note: reason, result: 'waived' }, now);
        added.push(existing.id);
      }
      continue;
    }
    for (let n = 2; rows.some((row) => row.id === id); n += 1) id = id.replace(/-\d+$/, '') + '-' + n;
    rows.push({ id, kind: 'waived', property: reason, covers: entry, covers_hash: hashCovers(root, [entry]).hash, command: '', level: '', red: '', status: 'waived', checked_at: timestamp(now), commit: headShort(root), ran_hash: '' });
    appendHistory(root, { id, event: 'waive', commit: headShort(root), hash: '', note: reason, result: 'waived' }, now);
    added.push(id);
  }
  writeLedger(root, rows);
  return { errors: [], added };
}

// Recognize the bundled checker's two formats and an explicit contract for other commands.
// A successful process alone says nothing about the strength of its search.
export function verificationResult(stdout) {
  const text = String(stdout ?? '').trim();
  if (text.startsWith('{')) {
    let result;
    try { result = JSON.parse(text); } catch { return { error: 'invalid JSON result' }; }
    if (typeof result.exhaustive !== 'boolean' || !Array.isArray(result.checks) || !result.checks.length || result.checks.some((check) => typeof check.ok !== 'boolean' || !LEVELS.includes(check.level))) return { error: 'JSON result lacks an exhaustive flag and valid checks with levels' };
    if (result.checks.some((check) => !check.ok)) return { error: 'JSON result contains a failed check' };
    const levels = [result.exhaustive ? 'exhaustive' : 'bounded', ...result.checks.map((check) => check.level)];
    return { level: levels.reduce((weakest, level) => LEVELS.indexOf(level) > LEVELS.indexOf(weakest) ? level : weakest, 'exhaustive') };
  }
  const levels = [...text.matchAll(/^VERIFICATION_LEVEL:\s*(exhaustive|bounded|sampled)\s*$/gim)].map((match) => match[1].toLowerCase());
  if (/^BOUNDED\b/m.test(text)) levels.push('bounded');
  if (/^Exhaustive\./m.test(text)) levels.push('exhaustive');
  if (!levels.length) return { error: 'no verification level reported; print VERIFICATION_LEVEL: exhaustive, bounded, or sampled' };
  return { level: levels.reduce((weakest, level) => LEVELS.indexOf(level) > LEVELS.indexOf(weakest) ? level : weakest, 'exhaustive') };
}

// Runs the check. It records the result and the commit, and leaves the sync hash alone: a green run does not prove the model still
// describes new code, only that the old description still holds. sync is the step that says someone read the change.
export function runRow(root, row, { timeoutMs = 600000, now = new Date() } = {}) {
  const started = Date.now();
  // The command is the shell's, so it works with the shell of the machine. NODE_TEST_CONTEXT is removed so a check that uses node --test is not read as part of this process's own test run.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(row.command, { shell: true, cwd: root, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, env });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  let ok = result.status === 0;
  let note = ok ? 'exit 0' : result.error?.code === 'ETIMEDOUT' ? 'timed out after ' + Math.round(timeoutMs / 1000) + ' s' : 'exit ' + result.status;
  if (ok && /^FAIL\s+\S/m.test(output)) { ok = false; note = 'exit 0 but the output has a FAIL line'; }
  if (ok) {
    const observed = verificationResult(result.stdout);
    if (observed.error) { ok = false; note = observed.error; }
    else if (LEVELS.indexOf(observed.level) > LEVELS.indexOf(row.level)) { ok = false; note = `the ledger says ${row.level} but the checker reported ${observed.level.toUpperCase()}. Raise its limits, or change the level`; }
  }
  row.status = ok ? 'holds' : 'broken';
  row.checked_at = timestamp(now);
  row.commit = headShort(root);
  row.ran_hash = hashCovers(root, splitCovers(row.covers)).hash;
  appendHistory(root, { id: row.id, event: 'run', commit: row.commit, hash: row.ran_hash, note: note + ', ' + Math.round((Date.now() - started) / 100) / 10 + ' s', result: ok ? 'holds' : 'broken' }, now);
  return { ok, note, output };
}

export function syncRow(root, row, note, now = new Date()) {
  const said = String(note ?? '').trim();
  if (said.length < 12) return { errors: ['--note must say what you read and why the property still describes the code'] };
  if (row.kind === 'waived') return { errors: ['a waiver has nothing to sync'] };
  if (row.status !== 'holds') return { errors: ['the last run of ' + row.id + ' is ' + row.status + '. Run it and get green before moving the sync forward'] };
  const hash = hashCovers(root, splitCovers(row.covers));
  if (hash.missing.length) return { errors: ['covered path is gone: ' + hash.missing.join(', ') + '. Amend the covers first'] };
  if (hash.links.length) return { errors: ['covered paths contain symlinks. Amend the covers to real project paths first'] };
  if (row.ran_hash !== hash.hash) return { errors: ['the covered code changed after the last green run of ' + row.id + '. Run it again on the code as it is now, then sync'] };
  row.covers_hash = hash.hash;
  appendHistory(root, { id: row.id, event: 'sync', commit: headShort(root), hash: hash.hash, note: said, result: 'holds' }, now);
  return { errors: [] };
}

export function amendRow(root, row, changes, evidence, now = new Date()) {
  const said = String(evidence ?? '').trim();
  if (said.length < 12) return { errors: ['--evidence must cite why the promise changed on purpose: a commit, a test, a doc line'] };
  const before = { property: row.property, covers: row.covers, command: row.command, level: row.level };
  const next = { ...row, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
  next.covers = splitCovers(next.covers).join(',');
  const errors = checkRow(root, next);
  if (errors.length) return { errors };
  Object.assign(row, next, { covers_hash: hashCovers(root, splitCovers(next.covers)).hash, status: 'unchecked' });
  appendHistory(root, { id: row.id, event: 'amend', commit: headShort(root), hash: row.covers_hash, note: 'was ' + JSON.stringify(before) + ' evidence: ' + said, result: 'unchecked' }, now);
  return { errors: [] };
}

export function retireRow(root, id, why, now = new Date()) {
  const said = String(why ?? '').trim();
  if (said.length < 12) return { errors: ['--why must say why this property no longer applies'] };
  const rows = readLedger(root);
  const keep = rows.filter((row) => row.id !== id);
  if (keep.length === rows.length) return { errors: ['no such property: ' + id] };
  writeLedger(root, keep);
  appendHistory(root, { id, event: 'retire', commit: headShort(root), note: said, result: 'retired' }, now);
  return { errors: [] };
}

// Which rows cover a path. A row covers a file when it names the file or a folder above it.
export const covering = (rows, file) => rows.filter((row) => splitCovers(row.covers).some((entry) => file === entry || file.startsWith(entry + '/')));

// Code that changed on this branch since base, that a reader would expect a rule for. Tests, config and the ledger itself are left out.
// On the main branch, or with no main to compare with, there is no branch to diff, and code that was committed is as much without a rule as code
// that was not. Then the whole project counts. The base is null and the messages say "in the project". On another branch, or with --base, only
// what changed since the base counts.
export function changedCode(root, base) {
  const main = ['main', 'master'].find((name) => git(root, ['rev-parse', '--verify', '--quiet', name]) !== null);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const whole = base === undefined && (!main || branch === main || branch === 'HEAD');
  const ref = base ?? main ?? null;
  const mergeBase = whole ? null : git(root, ['merge-base', ref, 'HEAD']) ?? ref;
  const listed = whole ? (git(root, ['ls-files']) ?? '').split('\n') : (git(root, ['diff', '--name-only', mergeBase]) ?? '').split('\n');
  const fresh = (git(root, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n');
  const wanted = (file) => file && CODE.test(file) && !TEST_FILE.test(file) && !file.startsWith('verify/') && !file.split('/').some((part) => SKIP_DIRS.has(part)) && fs.existsSync(path.join(root, file));
  return { base: whole ? null : ref, files: [...new Set([...listed, ...fresh])].filter(wanted).sort() };
}

// The code files a waiver covers. A waiver says nothing there can be stated, so the report names how much it excuses.
export function waivedCode(root, rows) {
  const files = [];
  for (const row of rows.filter((item) => item.kind === 'waived' && rowState(root, item).state === 'waived')) walk(root, splitCovers(row.covers)[0] ?? '', files);
  return [...new Set(files)].filter((file) => CODE.test(file) && !TEST_FILE.test(file)).sort();
}

export function gaps(root, base) {
  const rows = readLedger(root);
  const { files, base: used } = changedCode(root, base);
  return { base: used, files, uncovered: files.filter((file) => covering(rows, file).filter((row) => row.kind !== 'waived' || rowState(root, row).state === 'waived').length === 0) };
}

export const PROCEDURE = 'No rule covers this code, so start the verification procedure: run `100x ref properties` and follow it. Extract what can exist (state), how it changes (transitions), when a step is allowed (preconditions), what is true after it (postconditions), what always holds (invariants) and what must eventually happen under stated assumptions (liveness). Check them with the property checker from the 100x skill (skills/100x/assets/property-checker.mjs) or a tool that fits, show each fail on a seeded defect, then 100x verify add. Code with no rule to extract, such as layout or copy, gets 100x verify waive with the reason.';

// What 100x finish asks of the ledger. required is 'properties' when the one thing that must not break is its properties (a real property is
// needed), 'any' when property checks are on (a property or a waiver with its reason is needed), or false when the owner switched them off.
export function checkLedger(root, { required = false, base } = {}) {
  const errors = [];
  const warnings = [];
  const rows = readLedger(root);
  const proper = rows.filter((row) => row.kind !== 'waived');
  if (required === 'properties' && proper.length === 0) errors.push('the must-not-break kind is properties, but verify/ledger.tsv holds no property. Extract them (100x ref properties) and record each with 100x verify add');
  else if (required && rows.length === 0) errors.push('verify/ledger.tsv is empty. Property checks are on, so every run records the properties of the code that has logic with 100x verify add, or a waiver with its reason for code with none (100x verify waive <path> --why "<reason>"). The owner turns this off with 100x config set verify.enabled false');
  for (const row of proper) {
    const { state, why } = rowState(root, row);
    if (state !== 'holds') errors.push('property ' + row.id + ' is ' + state + '. ' + why + '. Fix it with 100x verify run ' + row.id + (state === 'stale' ? ' and then 100x verify sync ' + row.id + ' --note "<what you read>"' : ''));
  }
  for (const row of rows.filter((item) => item.kind === 'waived')) {
    const { state, why } = rowState(root, row);
    if (state !== 'waived') errors.push(`waiver ${row.id} is ${state}. ${why}. Read the changed content and use 100x verify waive with a reason, or retire it`);
  }
  if (rows.length || required) {
    const found = gaps(root, base);
    if (found.uncovered.length) {
      const text = found.uncovered.length + ' changed code file' + (found.uncovered.length === 1 ? ' has' : 's have') + ' no rule and no waiver ' + (found.base ? 'since ' + found.base : 'in the project') + ': ' + found.uncovered.slice(0, 6).join(', ') + (found.uncovered.length > 6 ? ' and ' + (found.uncovered.length - 6) + ' more' : '') + '. 100x verify gaps says what to do';
      if (required === 'properties') errors.push(text);
      else warnings.push(text);
    }
  }
  const waived = waivedCode(root, rows);
  if (waived.length) warnings.push(waived.length + ' code file' + (waived.length === 1 ? ' is' : 's are') + ' waived, so no property was written for ' + (waived.length === 1 ? 'it' : 'them') + ': ' + waived.slice(0, 6).join(', ') + (waived.length > 6 ? ' and ' + (waived.length - 6) + ' more' : '') + '. Say so in the report');
  return { errors, warnings, rows };
}
