import fs from 'node:fs';
import path from 'node:path';
import { clockSpan, clockStatus, fillGate } from './clock.mjs';
import { load, reportedUsual } from './config.mjs';
import { checkMustNotBreak, mustNotBreakList, mustNotBreakOutcome } from './must-not-break.mjs';
import { CliError } from './errors.mjs';
import { git, stageTags } from './git.mjs';
import { inspectImage } from './image.mjs';
import { finalMatrix, passNames, readAsks, readRun, runRows, stateFile, startedAt, targetIsOurs, targetMatchesRun, writeFinished, writeRun } from './project.mjs';
import { checkPrompt, verifyOn } from './prompt.mjs';
import { runId, upsert } from './registry.mjs';
import { runCmdProblem } from './run-command.mjs';import { checkLedger } from './verify.mjs';
import { listProblems, modern } from './runfile.mjs';
import { buildReport, buildReportHtml, chatSummary } from './report.mjs';
import { checkTriage, judgeRoom, pointsAtSomething, reviewCall } from './review.mjs';
import { REPO_ROOT } from './paths.mjs';
import { LENSES, closeRound, lensFor, nextSlot, pendingEntry, plannedFor, plannedRounds, roundStatus, roundsSummary } from './rounds.mjs';
import { lateClock, soloProblems } from './solo-check.mjs';
import { whyNotReady } from './why-not.mjs';
import { engineeringAssessment } from './workbench.mjs';

export const VERDICTS = ['ship', 'fine', 'dud'];
const REVIEW_STATUS = ['reviewed', 'unreviewed'];
const present = (value) => typeof value === 'string' && value.trim().length > 0;
const within = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);

function checkHero(root, hero) {
  const errors = [];
  const warnings = [];
  if (!present(hero)) return { errors: ['hero is missing, give the path of a screenshot'], warnings };
  let real;
  let home;
  try {
    home = fs.realpathSync(root);
    real = fs.realpathSync(path.resolve(root, hero));
  } catch {
    return { errors: [`hero ${hero} does not exist`], warnings };
  }
  if (!within(home, real)) return { errors: [`hero ${hero} is outside the project folder. Copy the screenshot into the project first`], warnings };
  const image = inspectImage(real);
  for (const problem of image.problems) errors.push(`hero ${hero} ${problem}`);
  // Only a PNG the checker can read says whether the page was blank, and 100x shots writes exactly that.
  if (!image.problems.length && image.type !== 'png') errors.push(`hero ${hero} is a ${image.type.toUpperCase()}. A hero is a PNG screenshot, because only a PNG can be checked for a blank page. Pick one from .100x/shots/final, or take it with \`100x shots\``);
  else if (!image.problems.length && image.dominantShare === undefined) errors.push(`hero ${hero} is a PNG this check cannot read (16 bit, interlaced or with a palette), so it cannot tell a blank page from a real one. Use a screenshot \`100x shots\` wrote, from .100x/shots/final`);
  if (!within(path.join(home, '.100x', 'shots'), real)) warnings.push(`hero ${hero} is not one of the 100x shots screenshots. Pick it from the final matrix when you can`);
  return { errors, warnings };
}

function checkMatrix(root, run, errors, warnings) {
  const matrix = finalMatrix(root);
  if (!matrix) {
    if (present(run.matrixSkipped)) warnings.push(`no resolution matrix, skipped because ${run.matrixSkipped.trim()}`);
    else errors.push('no resolution matrix. Run `100x shots <url> --label final --matrix all`. A project with no screen records the reason with `100x run set matrixSkipped "<reason>"`');
    return null;
  }
  const started = Date.parse(startedAt(root));
  if (!matrix.sealed) errors.push(`the ${matrix.label} matrix was not written by \`100x shots\`, or it was changed after it was, so it does not count. Run \`100x shots <url> --label ${matrix.label} --matrix all\` again. The tool signs what it measures`);
  if (matrix.sealed && targetIsOurs(root, matrix.target, run) && !targetMatchesRun(matrix.target, run)) errors.push(`the ${matrix.label} matrix looked at ${matrix.target}, but run.json says the app opens at ${run.url}. The screens have to be of what the owner opens. Run \`100x shots ${run.url} --label ${matrix.label} --matrix all\` against the running app, or correct the address with \`100x run set url\``);
  if (matrix.sealed && !targetIsOurs(root, matrix.target, run)) errors.push(`the ${matrix.label} matrix looked at ${matrix.target ?? 'no page'}, which is not this project. A screen run has to look at a file inside the project or a page served from this machine. Run \`100x shots <your address> --label ${matrix.label} --matrix all\` on the prototype`);
  if (matrix.startedAt && Date.parse(matrix.startedAt) < started) errors.push(`the ${matrix.label} matrix ran at ${matrix.startedAt}, before this run started, so it measured other code. Run \`100x shots\` again`);
  if (matrix.totals.broken > 0) {
    if (run.verdict === 'ship') errors.push(`verdict is ship but the ${matrix.label} matrix has ${matrix.totals.broken} broken findings. Fix them, or call the verdict fine`);
    else warnings.push(`the ${matrix.label} matrix still has ${matrix.totals.broken} broken findings`);
  }
  return matrix;
}

// What a fill clock got done: how long it ran, how many rounds were logged, and why it stopped early if it did.
export function workSummary(root, now = new Date()) {
  const status = clockStatus(root, now);
  if (!status.fill) return null;
  const rounds = runRows(root).filter((row) => row.phase === 'round' && Date.parse(row.ts) >= Date.parse(status.setAt)).length;
  const minutes = Math.max(0, Math.min(status.totalMinutes, Math.round((now - Date.parse(status.setAt)) / 60000)));
  return { minutes, rounds, totalMinutes: status.totalMinutes, stoppedEarly: status.stopped?.reason ?? null };
}

// The judge's rounds. Every planned round has to be held, unless the clock has no room for another one. A clean round skips
// the rest of its lens, which nextSlot already knows.
function checkRounds(root, now) {
  const config = load({ cwd: root }).effective;
  const triage = checkTriage(root);
  const result = { errors: [], warnings: [] };
  if (triage.errors.length) return result;
  const status = roundStatus(root, plannedRounds(root, config.review));
  const pending = pendingEntry(root, plannedRounds(root, config.review), triage);
  const entries = pending ? [...status.entries, pending] : status.entries;
  // With grind on, the round about to close can be the green one, or one that asks for another, so the plan is worked out after it.
  const total = plannedFor(entries, config.review);
  const next = nextSlot(entries, total);
  if (next !== null) {
    if (judgeRoom(root, config, now).noRoom) result.warnings.push(`the judge held ${entries.length} of ${total} rounds. The clock had no room for round ${next}`);
    else result.errors.push(`the judge held ${entries.length} of ${total} rounds. Round ${next} (${LENSES[lensFor(next, total)]}) is next. Run \`100x brief\`, start the judge, triage, fix, and ask again`);
  }
  return result;
}

// The owner reads these first, on the report page and in the final message. Real runs wrote 400 characters of numbers and
// file names into them, so the limits are generous and the refusal says how to cut. The numbers belong in the report.
const READABLE = { pitch: 240, verdictWhy: 320, moment: 240 };
const TITLE_MAX = 70;
const STEP_MAX = 200;
const STEPS_MAX = 4;
const SUMMARY_MAX = 400;

export function readableFacts(run) {
  const errors = [];
  const title = String(run.title ?? '').trim().length;
  if (title > TITLE_MAX) errors.push(`title is ${title} characters, ${TITLE_MAX} at most. It is a name: it heads the card and the page, and on a phone it wraps over several lines. Put the rest in the pitch. Cut it with \`100x run set title "<shorter>"\``);
  for (const [key, max] of Object.entries(READABLE)) {
    const length = String(run[key] ?? '').trim().length;
    if (length > max) errors.push(`${key} is ${length} characters, ${max} at most. The owner reads it first, on the report page and in the final message. Say it in one or two plain sentences and keep the numbers for the report. Cut it with \`100x run set ${key} "<shorter>"\``);
  }
  const long = (Array.isArray(run.tryFirst) ? run.tryFirst : []).map((step, index) => [index + 1, String(step).trim().length]).filter(([, length]) => length > STEP_MAX);
  if (long.length) errors.push(`tryFirst step ${long.map(([number, length]) => `${number} (${length} characters)`).join(' and ')} is over ${STEP_MAX}. One action a step, in words a stranger follows. Write the list again with \`100x run set tryFirst '["step one","step two"]'\``);
  for (const check of mustNotBreakList(run)) {
    const length = String(check.summary ?? '').trim().length;
    if (length > SUMMARY_MAX) errors.push(`the must-not-break summary for ${check.kind ?? 'the check'} is ${length} characters, ${SUMMARY_MAX} at most. Keep the numbers and the red run, and leave the story to .100x/must-not-break/${check.kind ?? '<kind>'}.txt. Write it again with \`100x run set mustNotBreak '<json>'\``);
  }
  return errors;
}

const MOCKUP_CLOCK_MAX = 45;
const MOCKUP_SET_WITHIN = 20;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// A mockup is the idea as running code, in minutes. It skips the judges and the polish by design, so a run that was polished
// has no use for the name. Without this a stuck run could call itself a mockup and keep its moment with nobody having looked.
function checkMockup(root, run, passes) {
  const errors = [];
  if (passes.length || run.polishPasses > 0) errors.push(`run.json says mode mockup, but this run has polish passes (${passes.length ? passes.join(', ') : `polishPasses ${run.polishPasses}`}). A mockup has none. A run that was polished is a normal run: take the flag off with \`100x run unset mode\`, and a judge looks at it`);
  if (!fs.existsSync(path.join(root, 'MOCKUP.md'))) errors.push('a mockup writes MOCKUP.md in the project folder: the question, the verdict, the run command, what is fake. The 100x-mockup skill has the list');
  // A mockup sets its short clock in its first minutes. A clock that is long, late or missing belongs to a run that did not start as one.
  const clock = clockSpan(root);
  const late = clock ? Math.round((clock.setAt - Date.parse(startedAt(root))) / 60000) : 0;
  if (!clock) errors.push('a mockup keeps its own short clock, and this run has none. A mockup starts with `100x clock set +15m`');
  else if (clock.minutes > MOCKUP_CLOCK_MAX || late > MOCKUP_SET_WITHIN) errors.push(`a mockup keeps a short clock set when it starts (\`100x clock set +15m\`). This run's clock is ${clock.minutes} minutes and was set ${Math.max(0, late)} minutes after the run began, so the run did not start as a mockup`);
  return errors;
}

const sameAsBuilder = (root, review) => Boolean(review?.model && review.model === load({ cwd: root }).effective.builder?.model);

function validateEngineering(root, run, errors, warnings) {
  const need = (ok, message) => ok || errors.push(message);
  need(present(run.title), 'title is missing');
  need(present(run.pitch), 'pitch is missing');
  need(VERDICTS.includes(run.verdict), `verdict must be one of ${VERDICTS.join(', ')}`);
  need(present(run.verdictWhy), 'verdictWhy is missing');
  errors.push(...readableFacts(run));
  need(run.review && REVIEW_STATUS.includes(run.review.status), 'review.status must be reviewed or unreviewed');
  if (run.review?.status === 'unreviewed') need(present(run.review.note), 'an unreviewed run needs review.note with the reason');
  if (run.review?.status === 'reviewed') {
    need(present(run.review.model), 'a reviewed run needs review.model');
    need(runRows(root).some((row) => row.phase === 'review'), 'a reviewed run needs a review row in the decision log');
    errors.push(...checkTriage(root).errors.map((error) => `review. ${error}`));
    if (sameAsBuilder(root, run.review)) warnings.push('the reviewer and builder are the same model');
  }
  const engineering = run.engineering;
  if (!engineering || typeof engineering !== 'object' || Array.isArray(engineering)) {
    errors.push('engineering must describe the direct or planned work');
    return { errors, warnings, run };
  }
  need(['direct', 'planned'].includes(engineering.type), 'engineering.type must be direct or planned');
  need(typeof engineering.visual === 'boolean', 'engineering.visual must say whether visual evidence is required');
  if (engineering.visual === true) {
    const hero = checkHero(root, run.hero);
    errors.push(...hero.errors); warnings.push(...hero.warnings);
    if (!finalMatrix(root)) errors.push('visual engineering work requires a final resolution matrix');
    else checkMatrix(root, run, errors, warnings);
  } else if (engineering.visual === false) {
    need(present(engineering.visualReason), 'headless engineering work needs engineering.visualReason');
    run.matrixSkipped = engineering.visualReason;
    if (present(run.hero)) { const hero = checkHero(root, run.hero); errors.push(...hero.errors); warnings.push(...hero.warnings); }
  }
  if (engineering.type === 'direct') {
    need(present(engineering.evidence), 'direct work needs engineering.evidence describing its actual checks');
    run.acceptance = { status: 'NOT_FORMAL', reason: 'No formal QA contract was requested.', evidence: engineering.evidence };
  } else if (engineering.type === 'planned') {
    const environments = engineering.environments && typeof engineering.environments === 'object' && !Array.isArray(engineering.environments) ? engineering.environments : {};
    const found = engineeringAssessment(root, engineering.changeId, environments);
    if (found.error) errors.push(`engineering contract: ${found.error}`);
    else {
      run.acceptance = found.summary;
      if (found.summary.status !== 'PASS' && run.verdict !== 'dud') errors.push(`acceptance is ${found.summary.status}; a positive verdict requires PASS for the current candidate`);
    }
  }
  const ledger = checkLedger(root);
  errors.push(...ledger.errors.map((error) => `verify. ${error}`));
  warnings.push(...ledger.warnings.map((warning) => `verify. ${warning}`));
  return { errors, warnings, run };
}

export function validateRun(root, { now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const gate = fillGate(root, now);
  if (!gate.ok) errors.push(gate.message);
  const work = workSummary(root, now);
  if (work?.stoppedEarly) warnings.push(`the fill clock was stopped early. ${work.stoppedEarly}`);
  else if (work && work.rounds < Math.floor(work.minutes / 120)) warnings.push(`${work.minutes} minutes of work but only ${work.rounds} rounds logged. Log each round with \`100x log round "<lens>" "<what changed or why nothing>" "<evidence>"\``);
  const run = readRun(root);
  if (!run) return { errors: [...errors, '.100x/run.json does not exist. Create it with `100x run set title "<title>"` and the other keys. The list is in ' + path.join(REPO_ROOT, 'skills', '100x', 'references', 'finish.md') + '.'], warnings, run: null };
  // The lists below are walked by the report and the page, so a list that holds the wrong thing is named before anything else is read.
  const shape = listProblems(run);
  if (shape.length) return { errors: [...errors, ...shape], warnings, run: null };
  if (run.mode === 'engineering') return validateEngineering(root, run, errors, warnings);
  const need = (ok, message) => ok || errors.push(message);

  need(present(run.title), 'title is missing');
  need(present(run.pitch), 'pitch is missing, write one sentence');
  need(VERDICTS.includes(run.verdict), `verdict must be one of ${VERDICTS.join(', ')}`);
  need(present(run.verdictWhy), 'verdictWhy is missing, write one sentence with the evidence');
  need(present(run.moment), 'moment is missing, name the signature moment');
  need(present(run.runCmd), 'runCmd is missing');
  const unrunnable = present(run.runCmd) ? runCmdProblem(root, run.runCmd) : null;
  if (unrunnable) errors.push(`runCmd (${run.runCmd}) ${unrunnable}. The report page runs it in the project folder, so it has to start the prototype from there. Fix the command with \`100x run set runCmd "<command>"\`, or add what it needs`);
  // The report page and the final message hand this to the owner, who does not have your free port. A cold start wrote `PORT=$(100x port) npm start`.
  if (/(^|[\s;&|(`])100x\s/.test(run.runCmd ?? '')) errors.push('runCmd runs 100x. Write the project\'s own start command, the one the owner types in the project folder, for example `100x run set runCmd "npm start"`, and the address it opens at by default with `100x run set url http://localhost:4173`. The report page sets the port itself');
  need(Array.isArray(run.tryFirst) && run.tryFirst.filter(present).length >= 2, 'tryFirst needs at least 2 short steps');
  const stepCount = Array.isArray(run.tryFirst) ? run.tryFirst.filter(present).length : 0;
  need(stepCount <= STEPS_MAX, `tryFirst has ${stepCount} steps, ${STEPS_MAX} at most. The owner reads them on one screen. Keep the steps that reach the moment fastest`);
  errors.push(...readableFacts(run));
  need(Number.isInteger(run.polishPasses) && run.polishPasses >= 0, 'polishPasses must be a whole number');
  const passes = passNames(root);
  if (Number.isInteger(run.polishPasses) && run.polishPasses > passes.length) errors.push(`run.json says ${plural(run.polishPasses, 'polish pass', 'polish passes')} but .100x holds ${passes.length ? `${plural(passes.length, 'pass', 'passes')} (${passes.join(', ')})` : 'none'}. A pass leaves its shots in .100x/shots/pass-N and its judge in .100x/loops/pass-N. Say what really ran with \`100x run set polishPasses ${passes.length}\`, or run the missing passes`);
  need(run.review && REVIEW_STATUS.includes(run.review.status), 'review.status must be reviewed or unreviewed');
  // A mockup is judged by nobody, by design, so it is the one run that may say UNREVIEWED without trying a judge first.
  const mockup = run.mode === 'mockup';
  // A solo run is judged by the model that built it, in writing, and starts no other model. Its own checks come first.
  const solo = run.mode === 'solo';
  if (solo) errors.push(...soloProblems(root, run));
  if (mockup) errors.push(...checkMockup(root, run, passes));
  else {
    // The pipeline's promise is a number of judged polish passes. A run that did fewer is not the run the verdict describes.
    const { polish } = load({ cwd: root }).effective;
    const floor = run.verdict === 'dud' ? polish.dudPasses : polish.passes;
    if (passes.length < floor) {
      const left = `${passes.length ? plural(passes.length, 'polish pass', 'polish passes') : 'no polish passes'} behind`;
      // At 80 percent of the clock the unattended rules hand the run to wrap up, so the passes that did not fit are not a refusal. The report says how many ran.
      const clock = clockStatus(root, now);
      if (['running', 'passed'].includes(clock.state) && clock.usedPercent >= 80) warnings.push(`this run left ${left} and a run takes ${floor}, but ${clock.usedPercent} percent of the clock was used, so wrap up took over. The report says ${passes.length} of ${floor}`);
      else errors.push(`this run left ${left} and ${run.verdict === 'dud' ? `a run that needs work takes ${floor} (\`polish.dudPasses\`)` : `a run takes ${floor} (\`polish.passes\`)`}. Run the missing ${plural(floor - passes.length, 'pass', 'passes')}, each with its judge (stage 4). A run on a clock may finish with fewer once 80 percent of the clock is used. When the owner asked for fewer, \`100x config set polish.passes <n> --local\` says so, and the report shows it`);
    }
  }
  if (run.review?.status === 'unreviewed') {
    need(present(run.review.note), 'an unreviewed run needs review.note with the reason');
    // A judge that is set up has to be tried first. Skipping it out of caution is the failure this catches.
    // A judge the owner's limits refuse cannot start, which is the case UNREVIEWED is for, so the refusal is not an error here.
    let call = { enabled: false };
    try {
      call = reviewCall(root, load({ cwd: root }).effective, { now });
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
    }
    const tried = runRows(root).some((row) => row.phase === 'review');
    // A dud variant ends with no review, as the variants guide says, and that holds in a solo run too.
    const owesRound = solo && run.verdict !== 'dud';
    if (owesRound && !call.noRoom) errors.push('review.status is unreviewed, but a solo run judges itself, so no judge can fail to start. Run stage 6 yourself: `100x brief`, `100x review-call`, and the round procedure in `100x ref solo`. UNREVIEWED is for a clock with no room for a round, and the note says so');
    else if (owesRound && lateClock(root)) errors.push(`review.status is unreviewed, but ${lateClock(root)}`);
    else if (!solo && call.enabled && call.configured && !tried && !mockup && !call.noRoom) errors.push(`review.status is unreviewed, but a judge is set up (via ${call.via}) and no review attempt is logged. Run stage 6: \`100x review-call\`, start the judge, log it. UNREVIEWED is for a judge that failed to start, with the failure in the note. Nothing limits how many agents you may start for the judge.`);
  }
  if (run.review?.status === 'reviewed') {
    need(present(run.review.model), 'a reviewed run needs review.model');
    need(runRows(root).some((row) => row.phase === 'review'), 'a reviewed run has no review row in the decision log. Log the judge start with `100x log review "<what the judge looks at>" "<why>" "<where it runs>"`, as stage 6 says');
    if (!solo && sameAsBuilder(root, run.review)) warnings.push(`the judge (${run.review.model}) is the same model as the builder in your settings, so it shares the builder's blind spots. The report and the final message say so`);
    for (const error of checkTriage(root).errors) errors.push(`review. ${error}`);
    const rounds = checkRounds(root, now);
    errors.push(...rounds.errors.map((error) => `review. ${error}`));
    warnings.push(...rounds.warnings);
  }

  // A judge in every loop. Each polish pass (a pass-N folder under shots or loops) and each fill round (a round row) needs its ask,
  // the judge's findings and the builder's answers, or one model grades its own work and drifts.
  {
    const config = load({ cwd: root }).effective;
    if (config.review.enabled || solo) {
      const passes = passNames(root);
      const rounds = runRows(root).filter((row) => row.phase === 'round').length;
      const loops = [...passes, ...Array.from({ length: rounds }, (_, i) => `round-${i + 1}`)];
      // A project with a screen shoots every pass, so a pass that has a judge folder and no pictures was not looked at on screen.
      if (finalMatrix(root)) {
        for (const name of passes.filter((pass) => !fs.existsSync(stateFile(root, 'shots', pass)))) {
          errors.push(`polish ${name} has a judge folder and no pictures. A project with a screen shoots each pass, \`100x shots <url> --label ${name}\`. A project with no screen records why with \`100x run set matrixSkipped "<reason>"\` and has no final matrix.`);
        }
      }
      for (const name of loops) {
        const files = ['ask.md', 'judge.md', 'answers.md'].map((file) => stateFile(root, 'loops', name, file));
        if (!files.every((file) => fs.existsSync(file) && fs.statSync(file).size > 0)) {
          errors.push(solo
            ? `loop ${name} has no challenge. Write .100x/loops/${name}/ask.md, run \`100x review-call --loop ${name}\` for the steps, write judge.md in another chair, then answer every finding in answers.md.`
            : `loop ${name} has no judge. Write .100x/loops/${name}/ask.md, start the judge with \`100x review-call --loop ${name}\`, answer every finding in answers.md. A loop the builder grades itself does not count.`);
        } else {
          const judged = fs.readFileSync(files[1], 'utf8');
          if (!/^Judged by:/im.test(judged) || !/^Drifting: (yes|no)$/im.test(judged) || !/^Better: (yes|no)$/im.test(judged)) {
            errors.push(`loop ${name} judge.md does not show how it judged. It must start with a "Judged by:" line (looking, running, numbers or words) and end with the Drifting and Better lines. A judge that only read the builder's notes does not count.`);
          } else if (/^Better: no$/im.test(judged) || /^Drifting: yes$/im.test(judged)) {
            // Polish has no gate but its judge, so finish says what the judge said and leaves the call to the owner.
            warnings.push(`loop ${name}: its judge ended ${/^Better: no$/im.test(judged) ? 'Better: no' : 'Drifting: yes'}. Finish does not refuse on that. Read .100x/loops/${name}/judge.md before you ship.`);
          }
        }
      }
    }
  }

  const hero = checkHero(root, run.hero);
  errors.push(...hero.errors);
  warnings.push(...hero.warnings);

  // A mockup needs no must-not-break check, because only its moment has to work. One that is recorded is still checked.
  if (!(mockup && mustNotBreakList(run).length === 0)) errors.push(...checkMustNotBreak(root, run, { after: Date.parse(startedAt(root)) }).errors);

  // The ledger travels with the branch. A property whose covered code changed after its last sync, or whose last run failed, is a claim nobody backs.
  const verifying = verifyOn(root) && !mockup;
  const ledger = checkLedger(root, { required: mustNotBreakList(run).some((check) => check.kind === 'properties') ? 'properties' : verifying ? 'any' : false });
  if (!verifying && !mockup) warnings.push('verify. property checks are switched off (verify.enabled false), so nothing was verified and the report must say so');
  errors.push(...ledger.errors.map((error) => `verify. ${error}`));
  warnings.push(...ledger.warnings.map((warning) => `verify. ${warning}`));

  const { found, asks } = readAsks(root);
  if (!found || asks.length === 0) errors.push('project.md has no "## Asks" ledger. List every ask as "- [ ] text" and close each one.');
  const unfinished = checkPrompt(root).problems.filter((problem) => problem.section !== 'Asks' || (found && asks.length > 0));
  if (unfinished.length) errors.push('The prompt in project.md is not finished. references/prompt.md in the skill says how to write it.', ...unfinished.map((problem) => problem.message));
  const open = asks.filter((ask) => ask.status === 'open');
  if (open.length) errors.push(`${open.length} of ${asks.length} asks are still open. ${open.map((ask) => `"${ask.text.slice(0, 48)}"`).join('; ')}`);
  for (const ask of asks.filter((a) => a.status === 'dropped' && !/dropped:/i.test(a.text))) errors.push(`ask "${ask.text.slice(0, 48)}" is dropped without a reason. Write "(dropped: reason)".`);
  for (const ask of asks.filter((a) => a.status === 'done')) {
    const at = ask.text.search(/evidence:/i);
    if (at < 0) errors.push(`ask "${ask.text.slice(0, 48)}" is closed without evidence. Write "(evidence: where to look)".`);
    else if (!pointsAtSomething(ask.text.slice(at + 'evidence:'.length))) errors.push(`ask "${ask.text.slice(0, 48)}" has evidence that points at nothing a reader can check. Name a commit, a file, a command in backticks or a number, for example "(evidence: shots/final, 0 broken)".`);
  }

  checkMatrix(root, run, errors, warnings);
  if (run.verdict === 'ship' && mustNotBreakOutcome(run) === 'fail') errors.push('verdict is ship but a must-not-break check fails. Fix it, or call the verdict fine');
  if (run.features?.some((feature) => !present(feature.cutHint))) warnings.push('some features have no cutHint');
  if (run.verdict === 'dud') warnings.push('verdict is needs work, the report says what failed and the one change most likely to fix it');

  if (git(root, ['rev-parse', '--git-dir'])) {
    const dirty = git(root, ['status', '--porcelain']);
    if (dirty) {
      const count = dirty.split('\n').length;
      warnings.push(`${count} file${count === 1 ? ' has' : 's have'} uncommitted changes. Commit before finish so the run can be rebuilt`);
    }
    const polishTags = stageTags(root).filter((tag) => tag.startsWith('100x/polish-')).length;
    if (Number.isInteger(run.polishPasses) && run.polishPasses > polishTags) warnings.push(`run.json says ${run.polishPasses} polish passes but git has ${polishTags} polish tags`);
  }
  return { errors, warnings, run };
}

function withTriageCounts(root, review) {
  const { review: settings } = load({ cwd: root }).effective;
  const engineering = readRun(root)?.mode === 'engineering';
  const total = engineering ? 1 : settings.rounds;
  const usual = engineering ? 1 : reportedUsual('review.rounds', { cwd: root });
  const held = roundsSummary(root, total);
  if (held) {
    // A project's own file may ask for fewer rounds than the owner's setting. The owner reads that, so it cannot pass as the usual.
    return { ...review, flags: held.counts.flags, fixed: held.counts.accepted, rejected: held.counts.rejected, deferred: held.counts.deferred, severities: held.severities, rounds: { held: held.held, planned: held.planned, lenses: held.lenses, lastReady: held.lastReady, ...(usual > total ? { usual } : {}), ...(held.lastReady === false ? { why: whyNotReady(stateFile(root)) } : {}) } };
  }
  const { summary } = checkTriage(root);
  return { ...review, flags: summary.flags, fixed: summary.accepted, rejected: summary.rejected, deferred: summary.deferred, severities: summary.bySeverity };
}

export function finishRun(root) {
  const { errors, warnings, run } = validateRun(root);
  if (errors.length) throw new CliError(`Cannot finish. ${errors.length} problem${errors.length === 1 ? '' : 's'}.\n${errors.map((e) => `- ${e}`).join('\n')}`);
  if (run.review?.status === 'reviewed') closeRound(root, run.mode === 'engineering' ? 1 : plannedRounds(root, load({ cwd: root }).effective.review), checkTriage(root));
  let heroRel = null;
  if (present(run.hero)) {
    const heroSource = fs.realpathSync(path.resolve(root, run.hero));
    heroRel = `hero${path.extname(heroSource) || '.png'}`;
    const heroCopy = stateFile(root, heroRel);
    if (!fs.existsSync(heroCopy) || fs.realpathSync(heroCopy) !== heroSource) fs.copyFileSync(heroSource, heroCopy);
  }
  const started = startedAt(root);
  const matrix = run.mode === 'engineering' && run.engineering?.visual === false ? null : finalMatrix(root);
  const { asks } = readAsks(root);
  const solo = run.mode === 'solo';
  const review = run.review.status === 'reviewed' ? { ...withTriageCounts(root, run.review), ...(solo || sameAsBuilder(root, run.review) ? { sameAsBuilder: true } : {}), ...(solo ? { solo: true } : {}) } : run.review;
  const finishedAt = new Date().toISOString();
  const entry = {
    ...run,
    mustNotBreak: mustNotBreakList(run),
    review,
    id: runId(root, started),
    path: root,
    heroRel: heroRel ? `.100x/${heroRel}` : null,
    startedAt: started,
    finishedAt,
    matrix: matrix && { label: matrix.label, matrix: matrix.matrix, totals: matrix.totals, viewports: matrix.viewports, states: matrix.states, examined: matrix.examined },
    asks: { total: asks.length, closed: asks.filter((a) => a.status !== 'open').length, dropped: asks.filter((a) => a.status === 'dropped').length },
    decisions: runRows(root).length,
    tags: stageTags(root),
    work: workSummary(root),
  };
  // Build both reports before recording completion; malformed data must never
  // leave a finished marker behind when rendering fails.
  const report = buildReport(root, entry);
  const reportHtml = buildReportHtml(root, entry);
  fs.writeFileSync(stateFile(root, 'REPORT.md'), report);
  fs.writeFileSync(stateFile(root, 'REPORT.html'), reportHtml);
  writeRun(root, entry);
  upsert(entry);
  writeFinished(root, { runId: entry.id, finishedAt, verdict: entry.verdict });
  const reminders = [];
  try {
    const watchdog = JSON.parse(fs.readFileSync(stateFile(root, 'watchdog.json'), 'utf8'));
    reminders.push(`A watchdog is armed${watchdog.scheduledTaskId ? ` as ${watchdog.scheduledTaskId}` : ''}. Delete that scheduled task with your app's own tool, then run \`100x watchdog clear\`.`);
  } catch {
    if (fs.existsSync(stateFile(root, 'watchdog.json'))) reminders.push('A watchdog record is in .100x/watchdog.json. Delete its scheduled task, then run `100x watchdog clear`.');
  }
  return { entry, warnings, reminders, summary: chatSummary(entry) };
}
