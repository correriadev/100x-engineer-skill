import { parseArgs } from 'node:util';
import { load } from '../config.mjs';
import { requireRoot } from '../project.mjs';
import { MIN_JUDGE_MINUTES, reviewCall } from '../review.mjs';
import { LENSES } from '../rounds.mjs';

// A judge that is the model that builds shares its blind spots, so the line says what to do about it.
const selfReviewLine = (call) => `The judge is the model that builds${call.model ? ` (${call.model})` : ''}, so its look is a self-review and shares the builder's blind spots. Call 100x-setup and give the judge another model, or say in the review note that it was a self-review`;
const fallbackLine = (call) => `fallback ${call.fallbackTarget.model} if the first call cannot start${call.fallbackSameAsBuilder ? '. It is the model that builds, so its look is a self-review. Say so in the review note' : ''}`;

// A solo run starts nothing. The lines say which files to read and write, and the steps a loop judge follows when it is you.
function soloLines(call) {
  if (call.loop) {
    console.log(`Solo loop ${call.loop.name}. No judge starts: you judge it yourself, in another chair. Deadline ${call.deadlineMinutes} minutes.`);
    console.log(`ask      ${call.brief}`);
    console.log(`findings ${call.findings} (you write this file, then answers.md)`);
    for (const step of call.steps) console.log(step);
    return;
  }
  if (call.noRoom) {
    console.log(`No room for a round. ${call.minutesLeft} min are left on the clock and a round needs at least ${MIN_JUDGE_MINUTES}. Stop the rounds. Say why the review was skipped with \`100x run set review '{"status":"unreviewed","note":"no time left for a round: ${call.minutesLeft} min on the clock"}'\`, then run \`100x finish\`. It warns about this and does not fail.`);
    return;
  }
  if (call.round.done) {
    console.log(`All rounds are done, ${call.round.held} of ${call.round.total} held. Run \`100x finish\`.`);
    return;
  }
  console.log(`Solo round ${call.round.slot} of ${call.round.total}, ${LENSES[call.round.lens]}${call.round.open ? ', open' : ''}. No judge starts: you judge it yourself. Deadline ${call.deadlineMinutes} minutes.`);
  console.log(`brief    ${call.brief}`);
  console.log(`findings ${call.findings} (you write this file)`);
  console.log('Commit first. Read the brief in full and take the seat it names. Write the suspicions before you run anything, test them, then write the findings and the Ready to ship line. Only then write triage.md, fix, commit and run `100x triage`. `100x ref solo` has the whole procedure.');
}

const usage = `
100x review-call [--json] [--loop <name>]

Says how to start the judge, from your config. Run \`100x brief\` first.
With --loop <name> it starts the small judge for one loop (a polish pass, a fill round). That loop needs its ask file at
.100x/loops/<name>/ask.md first: what the loop tried to do, the moment, the before and after proof, and what changed.
via command  the judge is a shell command. Run \`100x review-run\`, which starts it in the background.
via harness  the judge starts through your agent app's own subagent tool. With --json the object under delegateTask holds
             the arguments, for example a subagent tool that takes a target takes it unchanged.
via none     no judge is chosen yet. Call 100x-setup, or choose a model from a different vendor than your own that this app can start.
Either way the call returns at once. A tool call that waits for a review of this size gives up after about a minute while
the judge keeps working, so the agent waits as the app allows and stops at deadlineMinutes. That is review.timeoutMinutes, or less
when a clock is running. With fewer than 15 minutes left on the clock the output says there is no room for a judge (noRoom in --json).
When review is off in config the output says so and the run must be marked unreviewed with that reason.
When the judge is the model that builds, the output says so and --json carries selfReview: true. Its look is a self-review, and the review note says that.
In a solo run (run.json says mode solo) no judge starts, whatever the settings say. The output names the brief and the findings file, and with --loop it
prints the steps for judging the loop yourself. --json carries solo: true and via self.
`;

export default {
  name: 'review-call',
  summary: 'Say how to start the configured judge.',
  usage,
  async run(argv) {
    const { values } = parseArgs({ args: argv, options: { json: { type: 'boolean' }, loop: { type: 'string' } } });
    const root = requireRoot();
    const call = reviewCall(root, load().effective, { loop: values.loop ?? null });
    if (values.json) return console.log(JSON.stringify(call, null, 2));
    if (call.solo) return soloLines(call);
    if (!call.enabled) {
      console.log('Review is off in config. Run `100x run set review \'{"status":"unreviewed","note":"review is off in config"}\'`.');
      return undefined;
    }
    if (call.noRoom) {
      console.log(`No room for a judge. ${call.minutesLeft} min are left on the clock and a judge needs at least ${MIN_JUDGE_MINUTES}. Stop the rounds. Say why the review was skipped with \`100x run set review '{"status":"unreviewed","note":"no time left for a judge: ${call.minutesLeft} min on the clock"}'\`, then run \`100x finish\`. It warns about this and does not fail.`);
      return undefined;
    }
    if (call.via === 'none') {
      console.log('No judge is chosen yet. Call 100x-setup, or pick a model from a different vendor than your own that this app can start, and log the choice.');
      console.log(`brief    ${call.brief}`);
      console.log(`findings ${call.findings} (the judge writes this file)`);
      return undefined;
    }
    if (call.loop) {
      const model = call.via === 'command' ? call.model : call.delegateTask.target.model;
      const opts = Object.entries(call.delegateTask?.target.options ?? {}).map(([k, v]) => `${k} ${v}`).join(', ');
      console.log(`Loop judge ${call.loop.name}. ${model ?? 'the command picks its own model'}${opts ? `, ${opts}` : ''}. Deadline ${call.deadlineMinutes} minutes.`);
      console.log(`ask      ${call.brief}`);
      console.log(`findings ${call.findings} (the judge writes this file)`);
      if (call.selfReview) console.log(selfReviewLine({ ...call, model }));
      if (call.fallbackTarget) console.log(fallbackLine(call));
      console.log(call.via === 'command' ? `Run \`100x review-run --loop ${call.loop.name}\`.` : 'Run `100x review-call --json --loop ' + call.loop.name + '` and pass the delegateTask object to your app\'s subagent tool. ' + call.startInCursor);
      return undefined;
    }
    if (call.round.done) {
      console.log(`All rounds are done, ${call.round.held} of ${call.round.total} held. Run \`100x finish\`.`);
      return undefined;
    }
    const model = call.via === 'command' ? call.model : call.delegateTask.target.model;
    const options = Object.entries(call.delegateTask?.target.options ?? {}).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(call.engineering ? 'Engineering review.' : `Round ${call.round.slot} of ${call.round.total}, ${LENSES[call.round.lens]}${call.round.open ? ', open' : ''}.`);
    console.log(`Review is on. ${model ?? 'the command picks its own model'}${call.delegateTask?.target.providerInstanceId ? ` via ${call.delegateTask.target.providerInstanceId}` : ''}${options ? `, ${options}` : ''}. Deadline ${call.deadlineMinutes} minutes.`);
    console.log(`brief    ${call.brief}`);
    console.log(`findings ${call.findings} (the judge writes this file)`);
    if (call.selfReview) console.log(selfReviewLine({ ...call, model }));
    if (call.fallbackTarget) console.log(fallbackLine(call));
    console.log(call.via === 'command' ? 'Run `100x review-run`.' : 'Run `100x review-call --json` and pass the delegateTask object to your app\'s subagent tool. ' + call.startInCursor);
    return undefined;
  },
};
