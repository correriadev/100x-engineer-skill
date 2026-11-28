import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { readRun, requireRoot } from '../project.mjs';
import { briefFile, buildBrief } from '../review.mjs';
import { LENSES, grindVerdict, grindWords, plannedRounds, readState, startRound } from '../rounds.mjs';

const usage = `
100x brief [--print] [--out <file>]

Builds the self-contained brief for the next round of the second-model review from the project's own files. The question
is "is this ready to ship, be brutal". Round by round the lens moves from the code and how it
behaves, to the UI and UX, to the ship test. review.rounds sets how many (5 by default). A clean round skips the rest of its
lens. Later briefs carry the earlier findings with the builder's answers, so the judge checks them instead of trusting them.
With review.grind on (the 100x-grind skill sets it) a ship test is planned after the usual rounds for as long as no judge has green lit the work.
Default output is .100x/review/brief.md. A finished round is archived under .100x/review/round-N/ and its files are cleared.
--print and --out write the brief for the round now open and change nothing else.
`;

export default {
  name: 'brief',
  summary: 'Write the reviewer brief for this project.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { print: { type: 'boolean' }, out: { type: 'string' } } });
    const root = requireRoot();
    const config = load().effective;
    if (values.print || values.out) {
      const text = buildBrief(root, { config });
      if (values.print) return process.stdout.write(text);
      fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
      fs.writeFileSync(path.resolve(values.out), text);
      return console.log(`brief ${path.resolve(values.out)} (${text.split('\n').length} lines)`);
    }
    if (readRun(root)?.mode === 'engineering') {
      const text = buildBrief(root, { config });
      const file = briefFile(root);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`Engineering review brief ${file} (${text.split('\n').length} lines)`);
      return;
    }
    const total = plannedRounds(root, config.review);
    const round = startRound(root, total);
    if (round.done) {
      const words = config.review.grind ? grindWords(grindVerdict(readState(root).entries)) : null;
      return console.log(words ? `${words} ${round.held} rounds held. Run \`100x finish\`.` : `All rounds are done, ${round.held} of ${total} held. Run \`100x finish\`.`);
    }
    const text = buildBrief(root, { config, round: { slot: round.slot, total, lens: round.lens } });
    const file = briefFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`Round ${round.slot} of ${total}, ${LENSES[round.lens]}${round.fresh ? '' : ', still open'}.`);
    console.log(`brief ${file} (${text.split('\n').length} lines)`);
    return undefined;
  },
};
