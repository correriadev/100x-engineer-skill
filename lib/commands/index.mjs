import brief from './brief.mjs';
import browsers from './browsers.mjs';
import clock from './clock.mjs';
import config from './config.mjs';
import doctor from './doctor.mjs';
import evalCommand from './eval.mjs';
import finish from './finish.mjs';
import helper from './helper.mjs';
import init from './init.mjs';
import install from './install.mjs';
import log from './log.mjs';
import morning from './morning.mjs';
import night from './night.mjs';
import port from './port.mjs';
import prompt from './prompt.mjs';
import ref from './ref.mjs';
import registry from './registry.mjs';
import report from './report.mjs';
import reviewCall from './review-call.mjs';
import reviewRun from './review-run.mjs';
import reviewVerify from './review-verify.mjs';
import run from './run.mjs';
import shots from './shots.mjs';
import solo from './solo.mjs';
import status from './status.mjs';
import text from './text.mjs';
import triage from './triage.mjs';
import upstream from './upstream.mjs';
import validate from './validate.mjs';
import verify from './verify.mjs';
import watchdog from './watchdog.mjs';
import workbench from './workbench.mjs';

export const commands = [init, install, config, clock, log, status, run, shots, port, prompt, ref, verify, workbench, brief, reviewCall, reviewRun, reviewVerify, helper, solo, triage, report, finish, registry, morning, night, watchdog, upstream, browsers, text, evalCommand, doctor, validate];
export const commandNames = commands.map((command) => command.name);
// The headings and the order of `100x help`. A test fails when a command is missing here or listed twice.
export const helpGroups = [
  ['During a run', ['init', 'prompt', 'status', 'log', 'run', 'clock', 'port', 'shots', 'text', 'ref', 'verify', 'workbench', 'report', 'finish']],
  ['Judging', ['brief', 'review-call', 'review-run', 'review-verify', 'helper', 'solo', 'triage', 'eval']],
  ['Nights and mornings', ['night', 'watchdog', 'morning', 'registry']],
  ['Setup and health', ['install', 'config', 'browsers', 'doctor', 'validate', 'upstream']],
];
// A pass-through command takes the flags of the tool it runs, so its flags are not checked against this list.
export const commandUsages = Object.fromEntries(commands.filter((command) => !command.passThrough).map((command) => [command.name, command.usage]));
