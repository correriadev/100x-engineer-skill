import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CHECK_STATUS, mustNotBreakList } from './must-not-break.mjs';
import { globalDir } from './paths.mjs';
import { modern } from './runfile.mjs';
import { compareEntries } from './score.mjs';
import { currentEngineeringState } from './workbench.mjs';

export const registryFile = () => path.join(globalDir(), 'runs.jsonl');

export const runId = (root, startedAt) => createHash('sha1').update(`${root}\n${startedAt}`).digest('hex').slice(0, 10);

// The registry is append only. Parallel runs finish at the same time, and a read, change, rewrite cycle
// loses rows when two of them overlap. An append lands at the end of the file whatever else is writing.
// A row starts on a new line when a crash left the last line unfinished, so it is never swallowed by it.
// Reading keeps the last row per id, and a row with removed set to true drops that id.
function append(row) {
  fs.mkdirSync(globalDir(), { recursive: true });
  const fd = fs.openSync(registryFile(), 'a+');
  try {
    const { size } = fs.fstatSync(fd);
    const last = Buffer.alloc(1);
    const open = size > 0 && fs.readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
    fs.writeSync(fd, `${open ? '\n' : ''}${JSON.stringify(row)}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

export function readRegistry() {
  const file = registryFile();
  if (!fs.existsSync(file)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof row?.id !== 'string') continue;
    if (row.removed === true) byId.delete(row.id);
    else byId.set(row.id, modern(row));
  }
  return [...byId.values()];
}

export function upsert(entry) {
  append(entry);
  return entry;
}

export function remove(id) {
  if (!readRegistry().some((entry) => entry.id === id)) return 0;
  append({ id, removed: true, at: new Date().toISOString() });
  return 1;
}

const VERDICTS = ['ship', 'fine', 'dud'];
const TEXT_FIELDS = ['title', 'pitch', 'verdictWhy', 'path', 'finishedAt'];

const isCount = (value) => Number.isFinite(value);

// What the ranking and the morning page read from every row, down to the counts, the checks and the reasons they add up. A row from an
// older build, or one damaged by hand, has to be left out and named, because one of them must not take down the page that shows every
// other run. This is the one place that looks, so what reads a row after it can trust its shape.
export function rowProblem(row) {
  row = modern(row) ?? {};
  const missing = TEXT_FIELDS.find((key) => typeof row[key] !== 'string' || !row[key].trim());
  if (missing) return `${missing} is missing`;
  if (row.mode !== 'engineering' && (typeof row.moment !== 'string' || !row.moment.trim())) return 'moment is missing';
  if (row.mode !== 'engineering' && (typeof row.runCmd !== 'string' || !row.runCmd.trim())) return 'runCmd is missing';
  if (!(typeof row.heroRel === 'string' && row.heroRel.trim()) && !(row.matrix == null && typeof row.matrixSkipped === 'string' && row.matrixSkipped.trim())) return 'heroRel is missing without a headless reason';
  if (!VERDICTS.includes(row.verdict)) return `verdict is ${JSON.stringify(row.verdict)}, not ship, fine or dud`;
  if (Number.isNaN(Date.parse(row.finishedAt))) return 'finishedAt is not a date';
  if (typeof row.review?.status !== 'string') return 'review is missing';
  if (row.matrix != null && !(isCount(row.matrix.totals?.broken) && isCount(row.matrix.totals?.weak))) return 'the screen size counts are not numbers';
  if (mustNotBreakList(row).some((check) => !CHECK_STATUS.includes(check.status))) return `a check has no status of ${CHECK_STATUS.join(', ')}`;
  const why = row.review.rounds?.why;
  if (why !== undefined && !(Array.isArray(why) && why.every((reason) => typeof reason?.title === 'string' && reason.title.trim()))) return 'the stored reasons are not a list of titles';
  return null;
}

const named = new Set();
function usable(row) {
  const problem = rowProblem(row);
  if (problem && !named.has(row.id)) {
    named.add(row.id);
    process.stderr.write(`warn  left out the registry row ${row.id} in ${registryFile()}: ${problem}. The other runs are shown. \`100x registry remove ${row.id}\` drops it.\n`);
  }
  return !problem;
}

// A run that finished before the row kept its mode is still a mockup when its folder has the mockup's file.
const withMode = (entry) => (entry.mode || !fs.existsSync(path.join(entry.path, 'MOCKUP.md')) ? entry : { ...entry, mode: 'mockup' });

// A row with started set is a run that has begun and not finished (lib/in-progress.mjs). It has none of the fields a finished run has,
// so it is not a damaged row and never reaches the ranking.
const finishedRows = () => readRegistry().filter((row) => row.started !== true);

export function select({ sinceHours, all = false, now = Date.now() } = {}) {
  const cutoff = all || !sinceHours ? 0 : now - sinceHours * 3600 * 1000;
  return finishedRows()
    .map((entry) => modern(entry))
    .filter(usable)
    .filter((entry) => Date.parse(entry.finishedAt) >= cutoff)
    .map((entry) => entry.mode === 'engineering' && entry.engineering?.type === 'planned' ? { ...entry, currentAcceptance: currentEngineeringState(entry.path, entry) } : entry)
    .map(withMode)
    .sort(compareEntries);
}

// How many rows in the window `select` leaves out as damaged, so the page can say it left some out and not only the terminal. A row with
// no readable date counts, because nothing shows it to be outside the window.
export function countLeftOut({ sinceHours, all = false, now = Date.now() } = {}) {
  const cutoff = all || !sinceHours ? 0 : now - sinceHours * 3600 * 1000;
  return finishedRows().filter((row) => rowProblem(row) && !(Date.parse(row.finishedAt) < cutoff)).length;
}

export function parseWindow(text) {
  const match = /^(\d+(?:\.\d+)?)(h|d)?$/.exec(String(text).trim());
  if (!match) return null;
  return Number(match[1]) * (match[2] === 'd' ? 24 : 1);
}
