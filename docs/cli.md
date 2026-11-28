# The CLI and where things live

Back to the [README](../README.md).

## The CLI

`100x help <command>` lists the flags.

| Command | Does |
|---|---|
| `init` | Scaffold `.100x/` in a project, keep it out of git, detect the stack. |
| `prompt` | Check the prompt in `project.md`, or print it as one text to paste into another chat. |
| `verify` | Keep the verified properties of the code in a ledger in the project (`verify/ledger.tsv`, tracked by git), run their checks, and say which rule covers a piece of code. |
| `ref` | Print one of the suite's shared references by name, such as `100x ref apps`. A skill installed on its own reads them this way. |
| `workbench` | Run the bundled Project Mapper, specification, execution or QA Python tool with its original arguments and working directory. |
| `install` | Link the skills and bootstrap `~/.100x`, or undo it. |
| `config` | Show or change settings. `config preset lite` or `medium` moves three settings for a smaller plan, `config preset standard` takes them back. |
| `log` | Append a decision row, or show recent ones. |
| `status` | Where the run stands, and whether it is finished. Only `100x finish` marks a run finished. |
| `run` | Set and push the run facts in `run.json` without hand editing JSON. |
| `shots` | Screenshot and check a page across resolutions and states. |
| `port` | Print a free local port for a dev server. |
| `brief` | Open the next judge round and write its brief from the project's own files and the earlier rounds. |
| `clock` | Keep a deadline and say how much time is left. `--fill` uses all of it, `finish` refuses until the work time is over. |
| `night` | Plan, feed and read a night of several briefs. |
| `review-call` | Say how the reviewer starts, as a command, through the app's subagent tool, or not chosen yet. |
| `review-run` | Start, check or stop the reviewer as a shell command, in the background. |
| `review-verify` | Say which model the app really ran for a helper, from the app's own log, and exit 1 when it is not the model you asked for. |
| `helper` | Start a helper (a judge, a bake-off arm, a child) on a Cursor model through the Cursor SDK, the only way a helper starts in Cursor. `helper models` lists the account's models with their parameters, `helper login` signs this machine in, and `helper run` prints the model asked for and the model the SDK reports, exit 3 when they differ. |
| `eval` | Two evals from plain files. `eval triggers` stages and scores a routing test: does a model that reads only the skill names and descriptions pick the right skill. `eval bakeoff` runs a blind skill-off against skill-on comparison and says "ahead" only when an exact sign test and a control check allow it. `eval bakeoff score` and `gallery` exit 2 when they withhold the verdict, so a shell chain stops. |
| `solo` | For a `100x-solo` run: write the challenge file of a stage from its template, and check that every challenge the run owes passes. Starts no model. |
| `triage` | Check that every finding has a decision and a reason. A passing triage closes the judge round. |
| `report` | Rebuild the report from the run facts. |
| `finish` | Validate and close a run, write the report, register it. |
| `registry` | List or prune finished runs. |
| `morning` | Write the gallery page (cards copy the run command), or serve it so Run and Stop start the prototypes. |
| `watchdog` | The text of the scheduled message, and the record of the task that posts it. |
| `upstream` | List pstack commits newer than the one 100x was built from. |
| `browsers` | Install Playwright and Chromium if missing. |
| `text` | Lint and check copy with `unslop-text`, the pinned copy in `vendor/`. |
| `doctor` | Check the install. |
| `validate` | Check the skill files. `--prose` also runs the `unslop-text` lint. |

## Where things live

```text
~/.100x/                 global: bin/100x, repo, config.json, profile.md, runs.jsonl, morning/, install.json
<project>/.100x/         per project, kept out of git
  project.md             brief, Asks ledger, moment, must not break, stack
  decisions.tsv          one row per decision
  STATE.md               stage and next step, the resume anchor
  shots/<stage>/         screenshots, matrix.json, contact-sheet.png and .html
  must-not-break/ review/ loops/   must-not-break checks, brief, findings, triage, loop judges
  run.json REPORT.html   the facts and the report of a run, as a page and as REPORT.md
  finished.json          written by 100x finish and nothing else
```
