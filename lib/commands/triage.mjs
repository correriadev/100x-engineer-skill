import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { readRun, requireRoot } from '../project.mjs';
import { checkTriage } from '../review.mjs';
import { LENSES, closeRound, grindVerdict, grindWords, lensFor, nextSlot, plannedFor, readState } from '../rounds.mjs';

const usage = `
100x triage [--json]

Checks that every finding in .100x/review/findings.md has a decision in .100x/review/triage.md.
Triage lines look like "F3 accept. fixed in a1b2c3", "F4 reject. the button is hidden on purpose" or "F5 defer. needs a backend".
Every decision needs a reason. A blocker cannot be deferred. Exit code 1 when anything is missing.
When the triage is complete the round is closed and archived, and the output says which round comes next.
With review.grind on (the 100x-grind skill sets it) the output also says whether the judge green lit the work, and the rounds
go on until it does, until three ship tests in a row bring nothing better, or until the round limit.
\`100x finish\` runs the same check for a reviewed run and takes the counts from it.
`;

const pad = (text, width) => String(text).padEnd(width);

export default {
  name: 'triage',
  summary: 'Check that every reviewer finding has a decision and a reason.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' } } });
    const root = requireRoot();
    const { review } = load().effective;
    const engineering = readRun(root)?.mode === 'engineering';
    const total = engineering ? 1 : plannedFor(readState(root).entries, review);
    const result = checkTriage(root);
    const closed = result.errors.length ? null : closeRound(root, total, result);
    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const row of result.rows) console.log(`${pad(row.id, 4)} ${pad(row.severity, 8)} ${pad(row.decision ?? 'UNTRIAGED', 9)} ${row.title}${row.reason ? `. ${row.reason}` : ''}`);
      if (result.summary) {
        const s = result.summary;
        console.log(`${s.flags} findings. ${s.accepted} accepted, ${s.rejected} rejected, ${s.deferred} deferred, ${s.untriaged} untriaged.`);
      }
      for (const warning of result.warnings) console.log(`warn  ${warning}`);
      for (const error of result.errors) console.log(`error ${error}`);
      if (!result.errors.length) {
        console.log('triage complete');
        const entries = readState(root).entries;
        if (closed) console.log(`Round ${closed.slot} of ${total} closed, ${LENSES[closed.lens]}. Ready to ship: ${closed.ready === null ? 'the judge did not say' : closed.ready ? 'yes' : 'no'}.`);
        if (engineering) return undefined;
        const planned = plannedFor(entries, review);
        const next = nextSlot(entries, planned);
        const verdict = review.grind ? grindVerdict(entries) : { state: 'go-on' };
        if (next !== null) console.log(`${review.grind && nextSlot(entries, review.rounds) === null ? 'Not green yet. ' : ''}Next, \`100x brief\` for round ${next} of ${planned}, ${LENSES[lensFor(next, planned)]}.`);
        else if (verdict.state === 'green') console.log(`${grindWords(verdict)} ${entries.length} rounds held. Fix what is accepted, then \`100x finish\`.`);
        else if (grindWords(verdict)) console.log(`${grindWords(verdict)} ${entries.length} rounds held. Stop here and say what the judges keep saying, then \`100x finish\`.`);
        else console.log(`All rounds are done, ${entries.length} of ${planned} held. Fix what is accepted, then \`100x finish\`.`);
      }
    }
    if (result.errors.length) process.exitCode = 1;
    return undefined;
  },
};
