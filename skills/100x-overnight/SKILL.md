---
name: 100x-overnight
description: "Use for /100x-overnight, or when the owner is leaving and wants finished prototypes waiting: 'while I sleep', 'I'm leaving', 'build these tonight', several briefs at once. Sets the clock, arms the watchdog, runs one brief here or one child per brief, and ends with the report ranking."
license: MIT
compatibility: "Needs the 100x command line tool on PATH (Node 22 or newer, and git) and the other skills of the 100x suite that this one names. Install the tool as the repository README says. Browser checks use Playwright, which `100x browsers` installs."
metadata:
  author: "correriadev"
  version: "0.1.0"
  repository: "https://github.com/correriadev/100x-engineer-skill"
---

# Overnight

Nobody answers until morning, so every run has to finish or end in a stated block. One brief runs in this thread. Several briefs run as one child per brief, because one thread cannot hold many full runs.

Done when every brief has a finished run or a stated block, the watchdog is deleted, and the final message is the ranking from the `100x-report` skill. With fill, no run finishes before the work time is over.

Messages to the owner follow `100x ref voice`: the answer first, one idea per line, one question last, every fact kept.

## Steps

1. Briefs. Split what the owner wrote into separate ideas. Wake time from the owner's words. With none, use 07:00 and log it. Never ask what a brief means: take the most reasonable reading and log it. With no brief at all there is nothing to read, so ask for one and start nothing until it comes. A length of work ("work for 10 hours", "use all night") means use all of it, called fill. The wake time is then that length from now.
2. Model. `100x config target overnight` is the model for the children. Empty means they follow this thread, except where `helper.only` is set: then `100x night next` hands out the locked selection, never an empty target. Calling this skill is the owner's consent for children. An app with no subagent tool runs the first brief here and lists the rest as not started.
3. One brief. Run the pipeline of the `100x` skill here, record `Mode: overnight` under Modifiers in `project.md`, and send its pre-flight (step 8, at most 12 lines). Follow `100x ref unattended` for how to decide without asking. After `100x init` run `100x clock set <wake time>`, or for fill `100x clock set "<the length>" --fill`, for example `100x clock set "for 10 hours" --fill`. Arm the watchdog, see `100x ref watchdog`. With fill, after the first working version follow `100x ref fill` until `100x finish` accepts. Finish with `100x finish`. Skip the rest of this list.
4. Several briefs.
   - `100x night start --until <wake time> --brief "<text>" ...`, or `--file` for a file with briefs separated by a line of `---`. It makes one folder per brief. A brief the owner wants as a mockup goes in with `--mockup "<text>"` and runs with `100x-mockup`. No word inside a brief decides that. `--parallel N` sets how many run at once, 2 by default. `--fill` makes every child use all the time, so set `--parallel` to the number of briefs.
   - Arm the watchdog for this thread, see `100x ref watchdog`. Children arm none.
   - Send a pre-flight of at most 8 lines, for several briefs only. How many briefs, the wake time, how many at once, the model in plain words. Keep working.
5. The loop, in your own turn, until nothing is waiting or running, or the wake time comes.
   - `100x night next --json`. When it has `delegateTask`, start it with your app's subagent tool unchanged, then `100x night record <slug> <taskId>` and log the start. In Cursor start it with `100x helper run` from `100x ref apps`, never the Task tool. When it says `none`, wait.
   - Wait the way `100x ref apps` says, then `100x night status`. Where the app wakes your thread when a child ends, do other work and end the turn. Elsewhere `sleep 240` in the shell and look again. A call that waits on a child gives up after about a minute, so do not use one.
   - A child that ended while its project is not finished is retried once. `100x night next --retry <slug>`, start it, record it. After two attempts, `100x night block <slug> "<what its log shows>"`.
   - Child output stays in the children. Read a child's result only when it ends.
6. Wake time or nothing left. `100x night end`, disarm the watchdog, then follow the `100x-report` skill. That ranking is the final message. Add every blocked project with its reason, and every project that was never started.

## What the children do

A child is another model, so a child never runs solo. An owner who wants no helpers calls `100x-solo` with a length of work instead, as one brief in one chat.

Each child runs the `100x` pipeline on its own folder, with the wake time as its deadline. At 20 percent of the time left it stops the remaining stages and runs the `100x-wrapup` skill, so every prototype ends working rather than half built. A child for a `--mockup` brief calls `100x-mockup` instead, with its own 15 minute clock, no judge and no wrap up. A retried mockup starts its mockup again, because a mockup never updates `STATE.md`, so there is nothing to resume from. `100x night next` writes all of this into the child's task.

## Safe while nobody watches

`100x ref unattended` has the rules for decisions, credentials, assets and what is never done unattended.

## What is proven

Measured. `100x night` and `100x clock` in tests, including the one at a time hand out, the limit, finished detection from the project's own files, retry and block, and no start in the last hour.
Unproven. A real night of several children in one app. The first one should be watched for the first hour.
