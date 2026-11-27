# The design of 100x

This file is the build spec the first run followed (November 2026). It is history, not the current behavior. What the skills do now is in `skills/100x/SKILL.md` and the `skills/100x-*` folders next to it, what the owner runs is in `README.md`, and why it changed is in `git log`. When this file and those disagree, they win.

A new run that continues the build reads this file, then `git log --oneline -20`, and continues at the first unchecked item under Build status.

## Goal

The owner builds many projects with coding agents and abandons most of them because they do not prototype well. 100x is one skill that runs in one thread and turns a brief into a prototype worth keeping. It spends effort where the owner always iterates (visuals, features, resolutions), tests the one thing that matters for each app, gets one review from a different model, and leaves a morning page that compares many overnight runs.

It keeps the decision discipline of pstack (MIT, pinned in `UPSTREAM.md`) and drops its subagent machinery, its PR endings, and its habit of testing everything.

## Done predicate

The MVP is done when all eight hold, each checked against the real artifact.

1. P1 Install. `scripts/install.sh` in an empty temp HOME links every skill, bootstraps `~/.100x`, is idempotent, and `--uninstall` removes only what it made.
2. P2 Structure. `100x validate` passes. Names match folders, descriptions carry trigger words and fit 1024 characters, links resolve, no orphan references, every `100x <command>` and every flag named in a skill exists, no long dashes in prose.
3. P3 Scripts. `npm test` passes, including a resolution matrix test that catches seeded overflow, clipped text, tiny tap targets, a blurry canvas and console errors, and stays silent on a clean page.
4. P4 Flow. An end to end test runs the agent's command sequence (init, shots, log, brief, finish, morning) on a fixture project, and the morning gallery is written.
5. P5 Prose. `100x validate --prose` passes. It runs `100x text lint --profile docs` on every agent-facing file and fails above a slop score of 8.
6. P6 Review. One Muse Wonder max review ran and every finding has an accept or reject row in the decisions log.
7. P7 Live. The skills are linked in `~/.agents/skills`, `100x doctor` is green on the real machine, and the reviewer confirmed it sees `100x` in a fresh session.
8. P8 Proof. `100x finish` computes what it reports. A text file as the hero, a matrix from before the run, a hand typed must-not-break count or a closed ask with no evidence is refused, and the reviewer's own fake run fails with five errors.

## Shape

- One CLI at `~/.100x/bin/100x` does the mechanical work (config, logs, screenshots, briefs, gallery, watchdog checks).
- One skill, `100x`, is the router and the pipeline. Each other mode is a skill of its own next to it: `100x-mockup`, `100x-wrapup`, `100x-overnight`, `100x-report`, `100x-setup`, `100x-continue`, `100x-judge`, `100x-grind`, `100x-solo`, `100x-status`, `100x-adhd`, `100x-bakeoff`. The owner picks a mode by calling it, and no word in a brief picks one. The two helpers every run shares, must-not-break and the watchdog, are in `skills/100x/references/`, and the runnable test templates are in `skills/100x/assets/`. (The first build had one skill and read trigger words, and a brief that mentioned a status page could start the wrong mode. See `docs/decisions.tsv`.)
- Every skill is a folder that stands alone and follows the Agent Skills specification (agentskills.io). `npx skills add --skill <name>` installs one skill by itself, so a skill never names a file outside its own folder: it names another skill by its name, and prints a shared guide with `100x ref <name>`. `name`, `description`, `license`, `compatibility` and `metadata` are the only front matter. The license, compatibility and metadata come from `package.json` through `node scripts/stamp-skills.mjs`, and `100x validate` checks all of it.
- One companion skill, `unslop-text`, lives in its own repository. A pinned copy ships in `vendor/` (see `companions.json`), the install links it, and `100x text` runs it. No submodules.
- State lives in files. Global in `~/.100x`, per project in `<project>/.100x`.
- One thread. No parallel helpers by default. The judge always runs in stage 6 and is the only other agent.

## Pipeline

| Stage | Name | Ends when | Artifact |
|---|---|---|---|
| 0 | Open | pre-flight written, config and profile read, watchdog armed if unattended | `.100x/project.md`, `start` row |
| 1 | Core | verdict of ready to ship, fine or needs work, with evidence | `.100x/shots/core`, `core` row |
| 2 | Build | first full version runs, the quick test passes, tag `100x/build` | commits |
| 3 | Depth | top predicted next asks built behind one seam each | cut-hints, tag `100x/depth` |
| 4 | Polish | three passes done, each with before and after counts and a loop judge answered | `.100x/shots/pass-N`, `.100x/loops/pass-N`, tags |
| 5 | Must not break | the one thing that must not break, tested hard | `.100x/must-not-break/` |
| 6 | Review | one other-model review triaged | `.100x/review/` |
| 7 | Ship | preview deployed if configured, never prod | commits, URL |
| 8 | Finish | report written, run registered | `.100x/REPORT.html` and `REPORT.md`, `run.json`, registry row |

Number phrases in the message (`3 versions`, `for 10 hours`, `5 rounds of judging`, `max 5 subagents`) work in `100x` and `100x-overnight`, as the router lists them. Nothing else in a brief changes a run, so a brief that mentions a status page gets built.

## Files

Global, `~/.100x`.

- `config.json` global settings.
- `profile.md` how the owner works and what they dislike. Read at stage 0.
- `runs.jsonl` registry, one line per finished run.
- `morning/index.html` the gallery.
- `bin/100x` symlink to the CLI. `repo` holds the repo path. `install.json` lists links made by the installer.

Project, `<project>/.100x`.

- `project.md`, `decisions.tsv`, `STATE.md`, `config.json`, `run.json`, `REPORT.html`, `REPORT.md`, `finished.json`
- `shots/<stage>/`, `loops/pass-N/`, `must-not-break/<kind>.txt`, `review/`

`run.json` is written with `100x run set|push|unset`, never by hand. `finished.json` is written only by `100x finish`, and `100x status` trusts it only when its run id matches the run.

Config precedence. defaults, then global, then project. Objects merge, arrays replace.

Decisions columns. `ts phase decision why evidence result`, tab separated, append only, one row per decision.

## CLI

`100x init|install|config|clock|log|status|run|shots|port|prompt|ref|verify|workbench|brief|review-call|review-run|review-verify|helper|solo|triage|eval|report|finish|registry|morning|night|watchdog|upstream|browsers|text|doctor|validate`. Run `100x help` for flags.

## Guardrails

- Never deploy to production unless the owner says so in the brief.
- Never push, never force-push, never rewrite published history. Commit locally.
- Stay inside the project folder and `~/.100x`.
- No new paid external services unless the project already has the keys.
- At most one second agent, and only the reviewer, unless the project config says otherwise.

## Build status

- [x] U0 Skeleton, license, notice, first commit, watchdog canary
- [x] U1 CLI core (config, log, init, doctor, validate)
- [x] U2 Resolution matrix (`100x shots`)
- [x] U3 Router skill, references, profiles
- [x] U4 setup mode
- [x] U5 must-not-break
- [x] U6 judge mode
- [x] U7 report mode, finish, registry, gallery
- [x] U8 watchdog
- [x] U9 Install script and real install
- [x] U10 Prose gate, README, notices
- [x] U11 The one subagent review and triage. Muse Wonder max wrote 14 findings, 13 accepted, 1 rejected, rows in the author's decisions log
- [x] Dogfood run. One real run of the router's instructions on an idle game in `~/.100x/dogfood/lighthouse-keeper`, state in its `.100x/STATE.md`, review off because the one second agent is spent. Finished as `wow`, registry id `8511ebaff7`, 0 broken and 0 weak in 15 viewports and 90 states. It found real defects in the game and in the suite checker, rows in the author's decisions log
- [x] Final verification and report. Watchdog deleted, `npm test` 189 of 189, `validate --prose` ok, `doctor --deep` ok, install and uninstall checked in an empty home, final commit made, nothing pushed
