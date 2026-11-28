---
name: 100x-continue
description: "Use for /100x-continue, or when a 100x run stopped and the owner says to pick it up: 'continue the run', 'resume the 100x run'. A watchdog message asks for the same. Resumes the unfinished run in this folder from its last true state."
license: MIT
compatibility: "Needs the 100x command line tool on PATH (Node 22 or newer, and git) and the other skills of the 100x suite that this one names. Install the tool as the repository README says. Browser checks use Playwright, which `100x browsers` installs."
metadata:
  author: "correriadev"
  version: "0.1.0"
  repository: "https://github.com/correriadev/100x-engineer-skill"
---

# Continue

Pick up the unfinished run in this folder. Nothing new is planned and nothing is asked. A watchdog message and a retried night child ask for the same thing. A retried night mockup is the one exception: it starts its mockup again and never calls this skill.

Done when the run is back at work from its last true state, or you told the owner in one line why there is nothing to pick up.

Messages to the owner follow `100x ref voice`: the answer first, one idea per line, one question last, every fact kept.

## Steps

1. Run `100x status`. Read `.100x/STATE.md`, `.100x/project.md` (the asks, the moment, the modifiers, and its rules and do-nots when it has them), the last ten rows of `.100x/decisions.tsv` and `git log --oneline -10`.
2. Decide by what you found.
   - No `.100x` folder, or no run in it: say so in one line and ask for the brief.
   - `100x status` says FINISHED: say so in one line with the verdict and point to `100x-report`. Start no work. When the owner added an ask, treat it as a new brief and run `100x init --fresh` first.
   - NOT FINISHED: go on.
3. Do not run `100x init` or `100x log --start`. They would begin a second run. Log one row: `100x log resume "continuing at <stage>" "<why it stopped, or that the owner said continue>" "<the Stage line of STATE.md, as written>"`.
4. Read the modifiers and the mode in `project.md`. A night run (`Mode: overnight`) or a fill clock: follow the `100x-overnight` skill, and arm the watchdog again when `.100x/watchdog.json` is missing. A mockup (`run.json` says mode mockup) keeps the `100x-mockup` skill and skips step 5, because a mockup never updates `STATE.md`, so its `Next:` line is still the one `100x init` wrote. Look at what the folder holds (`index.html`, screenshots, `MOCKUP.md`), go on at the first step of that skill the folder does not show as done, keep its 15 minute clock (`100x clock`) and start no judge. A grind (`Grind: yes`) keeps the `100x-grind` skill: when `100x config print` shows `review.grind` off, turn it on again, and go on at step 4 of that skill. A wrap up (`WRAPUP.md`, tag `100x/wrapup`) keeps the `100x-wrapup` skill. A solo run (`run.json` says mode solo) keeps the `100x-solo` skill: start no helper, go on at `Next:` in `STATE.md`, and let `100x solo check` say which challenge files are still owed.
5. Go on at `Next:` in `STATE.md`. When the code disagrees with it (uncommitted changes, a half made file), finish or undo that one step first, then make `STATE.md` true again.
6. Reply in at most three lines: where the run stood (the stage in plain words, from `100x ref words`), what you do now, the time left when a clock runs. Then keep working.
