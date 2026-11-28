import { checkWords, mustNotBreakList } from './must-not-break.mjs';
import { modern } from './runfile.mjs';
import { plural } from './text.mjs';

export const JUDGE_SAID_NO = 'The judge said NOT ready to ship';
export const JUDGE_GAVE_NO_ANSWER = 'The judge never said whether it is ready to ship';

// A count of breaks is added up over every screen size, so on its own 239 reads as a wreck when it can be a few breaks seen again at each
// size. Said with the sizes it adds up over, the owner can tell a few from many. A run that never said how many sizes keeps the plain count.
function brokenWords(matrix) {
  const things = plural(matrix.totals.broken, 'thing');
  return matrix.viewports > 0 ? `${things} broken, counted across ${plural(matrix.viewports, 'screen size')}` : `${things} broken at some screen sizes`;
}

// Each thing to know has a kind as well as its words, so a page can count runs by why they are on the list.
function alertsOf(run, matrix, checks) {
  // A mockup has no check and no judge by design, and says so in its review line, so those are not alarms for it.
  const mockup = run.mode === 'mockup';
  const items = checks.filter((check) => check.status === 'fail').map((check) => ({ kind: 'check-failed', text: `${checkWords(check).kind.replace(/^./, (c) => c.toUpperCase())} check FAILED` }));
  const acceptance = run.mode === 'engineering' ? run.acceptance : null;
  if (run.currentAcceptance) items.push({ kind: 'stale-acceptance', text: `Current acceptance is ${run.currentAcceptance.status}` });
  else if (acceptance?.status === 'FAIL') items.push({ kind: 'check-failed', text: 'Acceptance FAILED' });
  else if (acceptance?.status === 'INCONCLUSIVE') items.push({ kind: 'qa-inconclusive', text: 'Acceptance is INCONCLUSIVE' });
  if (!checks.length && !mockup && !acceptance) items.push({ kind: 'no-check', text: 'No check was recorded for the one thing that must not break' });
  if (matrix?.totals?.broken > 0) items.push({ kind: 'broken', text: brokenWords(matrix) });
  if (run.review?.status !== 'reviewed') {
    if (!mockup) items.push({ kind: 'no-judge', text: 'No judge looked at it' });
  } else if (run.review.rounds?.lastReady === false) items.push({ kind: 'judge-no', text: JUDGE_SAID_NO });
  else if (run.review.rounds?.lastReady === null) items.push({ kind: 'no-answer', text: JUDGE_GAVE_NO_ANSWER });
  return items;
}

// What the owner has to know before the good news, in the order they matter. Empty when nothing is wrong.
export const lookFirst = (run, matrix, checks) => alertsOf(run, matrix, checks).map((item) => item.text);

// Trouble that was found is red: a judge that said no, a check that failed, a screen that broke. A judge or a check that is only missing
// is missing proof, and is amber, so a page where most runs have no judge yet does not paint everything the same alarm.
const FOUND = ['check-failed', 'judge-no', 'broken'];
const foundTrouble = (items) => items.some((item) => FOUND.includes(item.kind));

// The tone of the look-first box on a run's report page, by the same rule as its card: bad when trouble was found, warn when only proof is missing.
export const lookTone = (run, matrix, checks) => (foundTrouble(alertsOf(run, matrix, checks)) ? 'bad' : 'warn');

// The one line a card carries about how far to trust a run, in the words the top of its report uses. It reads the review and the
// checks, never a flag a run may have lost: a mockup row with no mode still says that no judge looked at it. The tone is bad (trouble was
// found), warn (proof is missing, or a note) or ok. held is true when something is to be looked at first, whatever the tone.
export function trustLine(entry) {
  entry = modern(entry) ?? {};
  const found = alertsOf(entry, entry.matrix, mustNotBreakList(entry));
  const said = [...(entry.mode === 'mockup' ? ['A mockup, nobody judged it'] : []), ...found.map((item) => item.text), ...(entry.review?.sameAsBuilder ? [entry.review.solo ? 'A solo run: the model that built it judged it and no other model looked' : 'The judge was the model that built it'] : [])];
  if (!said.length) return { tone: 'ok', held: false, text: 'A judge looked at it, and the checks pass.' };
  return { tone: foundTrouble(found) ? 'bad' : 'warn', held: found.length > 0, text: `${said.join('. ')}.` };
}

// One verdict for a run, in one word. The builder's call stands while the proof behind it holds. A ready-to-ship or a fine run with
// something to look at first is that instead, so the badge, the count and the filter never say ready to ship beside a line that says
// the judge refused it.
export function decision(entry) {
  entry = modern(entry) ?? {};
  return entry.verdict !== 'dud' && trustLine(entry).held ? 'look' : entry.verdict;
}

// The reasons a run can be on the look-first list, the most serious first. A failed check is a fact, the judge's no is the verdict the
// owner asked about, and a missing judge or check is only the lack of proof.
const MAIN = [
  ['check-failed', (count) => `a check failed on ${count}`],
  ['judge-no', (count) => `the judge said no to ${count}`],
  ['no-answer', (count) => `the judge gave no ship answer on ${count}`],
  ['stale-acceptance', (count) => `acceptance needs rechecking on ${count}`],
  ['qa-inconclusive', (count) => `acceptance is inconclusive on ${count}`],
  ['broken', (count) => `things broke on screen in ${count}`],
  ['no-judge', (count) => `no judge looked at ${count}`],
  ['no-check', (count) => `no check was recorded for ${count}`],
];

// The most serious reason a run is on the list, or null when nothing is. A report reads its matrix and checks from the run folder, so
// they can be handed in.
export function worstReason(entry, matrix = entry.matrix, checks = mustNotBreakList(entry)) {
  const kinds = alertsOf(entry, matrix, checks).map((item) => item.kind);
  return MAIN.find(([kind]) => kinds.includes(kind))?.[0] ?? null;
}

// The reasons in the order a filter lists them when they tie, the most serious first.
export const REASON_KINDS = MAIN.map(([kind]) => kind);

// What a card's badge says for that reason, in two or three words.
const BADGE = { 'check-failed': 'Check failed', 'judge-no': 'Judge said no', 'no-answer': 'No ship answer', 'stale-acceptance': 'Evidence outdated', 'qa-inconclusive': 'QA inconclusive', broken: 'Broken screens', 'no-judge': 'No judge', 'no-check': 'No check' };
export const badgeWords = (kind) => BADGE[kind];

// One line on why the runs to look at first are there. Each run is counted once, under the most serious reason it has, so the numbers add up
// to the count on the line above it. The reason with the most runs comes first. Empty when fewer than two runs are on the list, because the
// card of a single run already says it.
export function heldBack(entries) {
  const counts = new Map();
  for (const entry of entries) {
    if (entry.mode === 'mockup' || decision(entry) !== 'look') continue;
    const main = worstReason(entry);
    if (main) counts.set(main, (counts.get(main) ?? 0) + 1);
  }
  if ([...counts.values()].reduce((sum, count) => sum + count, 0) < 2) return '';
  const said = MAIN.filter(([kind]) => counts.has(kind)).sort((a, b) => counts.get(b[0]) - counts.get(a[0])).map(([kind, words]) => words(counts.get(kind)));
  return `Why, the worst reason of each run: ${said.join(', ')}.`;
}
