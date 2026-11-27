<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/brand/mask-dark.png">
  <img src="docs/img/brand/mask.png" alt="A Guy Fawkes mask" width="220">
</picture>

# 100× ENGINEER SKILL

### No more "almost works" agentic coding

[![ci](https://github.com/DeadInternetStudios/100x-engineer-skill/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/DeadInternetStudios/100x-engineer-skill/actions/workflows/ci.yml)
[![release: 0.1.0](docs/img/badges/release.svg)](https://github.com/DeadInternetStudios/100x-engineer-skill/releases)
[![node: ≥ 22](docs/img/badges/node.svg)](https://nodejs.org/)
[![license: MIT](docs/img/badges/license.svg)](LICENSE)
![status: beta](docs/img/badges/status.svg)
[![Stars](https://img.shields.io/github/stars/correriadev/100x-engineer-skill?style=social)](https://github.com/correriadev/100x-engineer-skill/stargazers)

*100x is a skill by a former Cursor engineer that turns prompts into formally verified, production-ready code.<br>I use it to ship over 1,000 PRs to production every month, with a rollback rate below 2%.*

<sub><b>English</b> · <a href="i18n/README.es.md">Español</a> · <a href="i18n/README.zh.md">中文</a> · <a href="i18n/README.pt.md">Português</a> · <a href="i18n/README.ru.md">Русский</a> · <a href="i18n/README.ja.md">日本語</a> · <a href="i18n/README.fr.md">Français</a> · <a href="i18n/README.de.md">Deutsch</a> · <a href="i18n/README.ar.md">العربية</a> · <a href="i18n/README.hi.md">हिन्दी</a> · <a href="i18n/README.ko.md">한국어</a> · <a href="i18n/README.id.md">Bahasa Indonesia</a> · <a href="i18n/README.tr.md">Türkçe</a> · <a href="i18n/README.vi.md">Tiếng Việt</a> · <a href="i18n/README.bn.md">বাংলা</a> · <a href="i18n/README.it.md">Italiano</a> · <a href="i18n/README.pl.md">Polski</a> · <a href="i18n/README.th.md">ไทย</a> · <a href="i18n/README.uk.md">Українська</a> · <a href="i18n/README.nl.md">Nederlands</a></sub>

</div>

> **100x engineer**<br>
> /ˈwən ˈhən-drəd eks ˌen-jə-ˈnir/<br>
> *noun*
>
> A software engineer said to possess the output of one hundred ordinary engineers, without the meetings, questions, or failing tests.

Your agent says it's done. You open it and it *kinda* works. It always looks fine, but it's never quite ready to ship.

**100x makes your coding agent solve the last 10% of development.**

It can model selected properties and check integration behavior where suitable evidence is available. A model only proves the properties and behavior represented by that model.

<p align="center">
  <img src="docs/img/proof/tokens-30-days.jpg" width="420" alt="Daily token use from 23 Oct to 20 Nov: 136B tokens in 30 days, 1.6K local agents, 0 cloud agents">
</p>

<p align="center"><b>136B tokens in 30 days · 1 engineer · Serious projects · Over 1,000 PRs · $250k cache savings</b></p>

It is an open-source skill for Claude Code, Cursor and Codex. Give it one job, like adding a feature to your app or building a small app from scratch. It plans the work, builds it, polishes it and tests the part that matters most. A second AI model reviews it. You get a report with screenshots, test results and anything still open.

<p align="center">
  <a href="#install"><img src="docs/img/banners/install.png" width="760" alt="Install: two commands, then /100x-setup. Claude Code, Cursor or Codex, Node 22 or newer."></a>
</p>

<!-- Benchmark headline goes here: one line and one picture, the same agent with and without 100x, with a link to the method. -->

## Engineering workflow in this fork

For engineering changes, 100x coordinates project understanding, planning, construction and acceptance in one workflow. Project Mapper and New Scope are also available independently. Execute Scope and QA Scope are optional entry points to the same execution protocol and QA contract; they do not require another complete build or review. Prototype, visual, solo and exploration modes remain available.

- **Direct work:** for a bounded change, check authoring or execution of an existing procedure, inspect first and present the action plan before writes or effects. A map and formal contracts are optional. Report actual checks without claiming formal QA acceptance.
- **Planned work:** for a change ID, planned execution or formal acceptance, use New Scope to define behavior, risks and acceptance, and plan QA obligations before the relevant implementation. Publish the revision-bound task plan; stale or missing contracts block the affected work.
- **Review:** the existing 100x reviewer assesses the planned obligations and other material findings once. PASS, FAIL and INCONCLUSIVE reflect observed evidence and its limitations. Completion does not treat model checking, an exit code or the existence of a file as proof of unmodeled behavior.

| Artifact | Owner and purpose |
|---|---|
| `.project-mapper/graph.sqlite` | Source-backed project knowledge, snapshot and coverage. Consult current source before making claims or edits. |
| `docs/specs/<change-id>/context.sqlite` | Canonical intended change; `SCOPE.md` is its generated projection. |
| `tasks.json` | Published tasks, dependencies, execution phases and evidence history. |
| `qa.json` | Published evidence obligations and candidate assessments. |
| `verify/ledger.tsv` | Separate property checks and their actual verification levels. |
| `.100x/` | Run state, review materials, evidence artifacts and reports. |

Run `100x workbench mapper . --offline coverage --summary` to inspect an existing map. Use `100x workbench scope <change-folder> --help` for New Scope and `100x workbench execute` or `100x workbench qa` for their contract tools. `100x workbench path mapper` locates the complete installed package, including the optional C# parser requirements. A requested map refresh pins a committed Git snapshot; use an explicit worktree map for uncommitted changes. Refresh reuses compatible static extraction; semantic reuse remains conservative when mapped inputs change.

For a 100x report set `mode` to `engineering` and supply the direct or planned settings described in `100x ref engineering`. Headless work records why visual evidence is unnecessary and needs no screenshot. Visual work still requires its captures. Planned reports bind acceptance to the candidate, contracts, local artifact hashes and caller-confirmed environment identities. A reviewer must inspect the artifacts and assertions and independently observe the actual environment. Remote evidence needs a local snapshot within the task project. Fingerprinting excludes the change directory, `.100x`, map artifacts, Git metadata and dependency/cache directories except for declared task, check and source paths, and rejects source symlinks. It does not identify external services or running deployments; record those separately.

Path confinement, meaningful RED and frozen tests are supervisor and worker protocols backed by contract preflight and post-action audits; they are not an operating-system sandbox. The host's own permissions and sandbox remain authoritative.

Node.js 22+ is required for 100x. Mapping and planned engineering also need Python 3.12+, SQLite 3.37+ and Git. `X100_PYTHON` selects a Python executable. Browser dependencies are needed only for browser work; C# parsing requires the optional pinned dependencies in the Mapper package. `100x doctor` reports missing engineering requirements without disabling unrelated modes.

Existing prototype runs retain their format. Existing copied skill installations are preserved, not overwritten: run `100x install --dry-run` and refresh the old copy with its original installer, or replace it deliberately before linking this fork. A planned assessment created before candidate and evidence-history binding must be reassessed for the engineering report. Generic property commands must now print `VERIFICATION_LEVEL: exhaustive`, `bounded`, or `sampled`; the bundled checker reports its level in text or JSON. A waiver whose covered contents change is stale until reassessed. See [engineering workflow](skills/100x/references/engineering.md) and [verification](docs/verification.md).

The historical routing evaluation does not contain independent examples for the four imported Workbench skills, so its score is not evidence of their routing accuracy.

## Formal verification, one small block at a time

Nobody formally verifies a whole app in one piece. Some properties of a small block can be stated precisely and checked against a model. The prototype workflow uses that approach by default; engineering work selects checks for its actual risks.

### Six questions for every block

| Ask | What you write down |
|---|---|
| State | what can exist |
| Transitions | how it can change |
| Preconditions | when a step is allowed |
| Postconditions | what is true after a step |
| Invariants | what always holds |
| Liveness | what must eventually happen, and what that assumes |

The prompt answers all six in plain sentences. Then 100x builds a small model that runs your real functions, and a checker visits every state the model can reach. When something breaks, it prints the shortest list of steps that gets there.

### Small blocks add up to a big system

<p align="center">
  <img src="docs/img/diagrams/verified-blocks.svg" width="520" alt="Small verified blocks. Each block states six properties and is checked on its own: split a bill, order, refund. The seams between blocks are checked. The real blocks then run together in one system model. The ledger marks a proof stale when the code under it changes.">
</p>

Each modeled block can be checked on its own, and modeled seams can be checked together. These checks cover the modeled states, inputs and assumptions, not unmodeled integrations or runtime behavior.

### It stays true

The ledger is `verify/ledger.tsv`, in your repo, so it travels with every branch. Each row keeps a hash of the code it covers. Change that code and the row goes stale until someone reads the change, runs the check and syncs it. Every property has to fail once on a planted bug before it counts. `100x finish` refuses a property that is stale, broken or never failed. When an agent is about to touch code that no rule covers, `100x verify cover` answers `NO RULE`, and that starts the procedure.

```text
$ 100x verify run
pass  split-keeps-every-cent. invariant, exhaustive, exit 0

# someone swaps Math.floor for Math.round in the split
$ 100x verify status
stale   split-keeps-every-cent  the covered code changed after the last sync

$ 100x verify run
FAIL  inv:shares-keep-every-cent. a cent was lost or made. Steps: set-bill(1), set-people(2), compute
```

<sub>From a small tip splitter, run by hand in a scratch repo</sub>

### What verified means here

- **Exhaustive**: every state of the model was visited, so the property holds for that model and its bounds
- **Bounded**: the search hit a limit and found nothing in what it saw, which is not a proof, and liveness is never decided on it
- **Sampled**: chosen or random cases, good at finding bugs and silent about the rest

A pass covers the model and the real functions the checks run. Layout and copy have nothing to state, so they get a recorded waiver with a reason, and `100x finish` names the code each waiver excuses. To skip all of it, say `no verification` in the brief or run `100x config set verify.enabled false`. The report then says nothing was verified. [The details](docs/verification.md).

## Why agents stop at "almost works"

Three things go wrong, and 100x has an answer for each. Every example below uses the same request:

> Let me compare any stock with the S&P 500 in my stock market research app

### 1. Nobody wrote down what "works" actually means

The request is one line. Before it builds anything, 100x writes the prompt you would have written with an hour to spare. It sets the goal, the rules, the riskiest part, and how to check each ask. Here it spots the trap early: a stock split looks like a loss unless the chart adjusts for it.

<p align="center">
  <img src="docs/img/diagrams/prompt-step.svg" width="720" alt="You type &quot;Let me compare any stock with the S&P 500 in my stock market research app&quot;, and 100x first writes a full prompt of about 1000 words. An excerpt. Goal: both lines start at 0% on the first shared day. Rule: percent change from a shared start, not prices. Risk: a stock split shows up as a fake loss. Asks: 9, two of them tests that must fail first. Hard test: a two-for-one split shows 0% change. Do not: draw raw prices on a shared axis. Moment: type a ticker, both lines start at 0%. Judge: does a hand count across a split match?">
</p>

<p align="center"><a href="docs/examples/stock-comparison-prompt.md">Read the whole prompt</a></p>

### 2. The agent checks its own work

A model checking its own work misses its own mistakes. 100x has a second model review the code and the screens, in rounds. The builder fixes each finding or writes down why it disagrees. Here the prompt named the case of a newly listed stock and told the reviewer to press on it, but the builder's tests only used older stocks. The reviewer tried a stock listed this year and found the index line starting five months early.

<p align="center">
  <img src="docs/img/diagrams/review-catch.svg" width="720" alt="Illustrated review of the stock comparison chart. Before: the S&P 500 line starts 5 months before the stock line, so the two do not share a starting point. The second model flags it. After: both lines start at 0% on the first day both have prices. A test now fails if the start dates differ, and it passes.">
</p>

That one is illustrated. A real one: this README went through 100x before you read it. Its reviewer flagged 9 problems in the first round, from 20 dead language links to labels too small for a phone. 7 were fixed and 2 waited for the public launch. [Read what it found](docs/examples/readme-review.md).

### 3. The summary comes from memory

When an agent says "done", it reports what it remembers. 100x saves the evidence as it goes: screenshots, test output, the reviewer's findings. At the end, code writes the summary from those files, and `100x finish` refuses to write it while an ask has no evidence or a check is missing. This is the message at the end of the stock chart run. The research app is made up, so the run is illustrated.

<p align="center">
  <img src="docs/img/diagrams/final-message.svg" width="560" alt="The final message of the illustrated stock chart run, printed by 100x finish from the saved results. The same text follows as plain text.">
</p>

<details>
<summary>The same message as plain text</summary>

```text
Compare with the S&P 500: ready to ship.
The split math matches a hand count and both lines start on the same day. Dividends are not counted yet.

The moment: Type a ticker and both lines start at 0% on the same day, so the gap is the whole story
Run: npm run dev
Open: http://localhost:5173/compare
Try first:
1) Type a ticker you hold and read the gap to the index
2) Pick a stock that split two for one and check the split day shows no drop
3) Pick a stock listed this year and see where both lines start

Must not break: numbers passed (Percent change across a two-for-one split matches a hand count on 40 split cases, 0 failing)
Review (claude-opus-5-5): 9 flagged, 7 fixed, 1 rejected, 1 deferred
Judge rounds: 5 of 5 done, and the last word was ready to ship
Looked at: the code and how it behaves, the UI and UX and whether it is ready to ship
Screen sizes: 0 broken, 2 weak, 15 sizes and 148 elements checked
Asks: 9 of 9 closed

Report: file:///Users/you/projects/research-app/.100x/REPORT.html
Next likely asks: Count dividends in the comparison; Show the gap for several stocks in one table
```

</details>

- **The moment:** the one thing that should make you want it
- **Must not break:** the hard test, and whether it passed
- **Review:** what the second model flagged, and what the builder did with it
- **Asks:** the requirements from the prompt, each closed only with evidence
- **Next likely asks:** what you'd probably ask for next, built or listed already

## Send one message and walk away

The same request as a timeline. By hand, you keep coming back to answer questions and catch mistakes. With 100x, you send one message and read the report when you return. Blue is you and amber is the second model. We made up the times.

<p align="center">
  <img src="docs/img/diagrams/by-hand-feature.svg" width="720" alt="Illustrated run adding a stock comparison chart. By hand you send five messages and return to a question about shorter price histories. With 100x you send one request. The agent tests that a two-for-one split shows no loss, and a second model catches a mismatch in the chart start dates. The report shows the corrected chart and test results.">
</p>

<details>
<summary>The same on a small app built from scratch</summary>

<p align="center">
  <img src="docs/img/diagrams/by-hand-app.svg" width="720" alt="Illustrated overnight build. By hand you send five messages and wake up to a database question. With 100x you send one brief, the report is ready at 2:15 am, and you try the budget app in the morning.">
</p>

The budget app's prompt, written from four words: [make me a budget app](docs/examples/budget-app-prompt.md).

</details>

<details>
<summary>All eight steps of a run</summary>

| Step | What happens |
|---|---|
| 1. Plan | Your agent writes a detailed prompt. It spells out what to build and how to check each request. |
| 2. Core | It tries the riskiest part first, while there's still time to change the plan. |
| 3. Build | It builds the first version and the extras you're likely to ask for next. |
| 4. Polish | It works on the layout and details. A second model looks at screenshots after each pass and points out what's weak. |
| 5. Test | The agent tests the one thing that would ruin the work if it broke, like a chart getting a split wrong. It first shows that the test can catch a mistake. |
| 6. Review | The second model reviews the code and screens. The builder fixes each issue or writes down why it can wait or why it disagrees. |
| 7. Finish | The `100x finish` command checks the saved evidence before it writes the report. |
| 8. Report | You can see the result, try it yourself, and read what the reviewer found. |

If you're away, the agent writes down each decision it makes and keeps working. [Read the full workflow](docs/pipeline.md).

</details>

## What you get

<div align="center">

<img src="docs/img/morning-gallery.jpg" alt="The report page: three finished prototypes, each with a picture, one sentence on what it is, a verdict, the judge's reasons when it said no, the one moment that makes it worth a look and a way to run it" width="900">

<sub>The report page, drawn from three made-up runs. A real run puts its own screenshots on each card.</sub>

</div>

- **The feature or app**, and how to try it yourself
- **Screenshots at many screen sizes**, checked for spilled text, tiny buttons, blurry images and browser errors
- **A report page** (`.100x/REPORT.html`) and a gallery of every finished run in `~/.100x`
- **A verification ledger** in your repo: the properties of each block, whether each one holds, and the code it covers
- **A decision log**: every choice 100x made while you were away, and why
- **The final message** shown above

Each run gets one verdict: **Ready to ship**, **Fine** or **Needs work**. When something blocks a verdict, the card says what, in red when 100x found a problem and amber when a check is missing.

---

<div align="center">

## Real-life products built with 100x

<table align="left"><tr><td>
<a href="https://dollarflow.com/"><img src="docs/img/built/shot-dollarflow.jpg" alt="DollarFlow: Like Bloomberg Terminal but for normal people. Tesla trades 25% above its fair value, shown against its own history, its closest peers and every company." width="380"></a><br>
<a href="https://dollarflow.com/"><b>DollarFlow</b></a><br>
A stock screener, built<br>
with 100x assistance
</td></tr></table>
<table align="left"><tr><td>
<a href="https://springtails.wiki/"><img src="docs/img/built/shot-springtails.jpg" alt="Springtails Wiki: Springtails, with the evidence. Species pages, care cards, an idle game and a 3D anatomy explorer." width="380"></a><br>
<a href="https://springtails.wiki/"><b>Springtails Wiki</b></a><br>
A springtail wiki, built<br>
entirely with 100x
</td></tr></table>
<br clear="all">

<table align="left"><tr><td>
<a href="https://bubblewrapapp.com/"><img src="docs/img/built/shot-bubblewrap.jpg" alt="BubbleWrap: a grid of pixel art bubbles that play music when popped, with a track list, effects and a mixer." width="380"></a><br>
<a href="https://bubblewrapapp.com/"><b>BubbleWrap</b></a><br>
A pixel art music app,<br>
built entirely with 100x
</td></tr></table>
<table align="left"><tr><td>
<a href="https://goldtraderdesk.com/"><img src="docs/img/built/shot-goldtraderdesk.jpg" alt="Gold Trader Desk: a live XAU/USD price chart with upcoming events, and a panel to challenge a trade." width="380"></a><br>
<a href="https://goldtraderdesk.com/"><b>Gold Trader Desk</b></a><br>
A gold trading app, built<br>
entirely with 100x
</td></tr></table>
<br clear="all">

<table align="left"><tr><td>
<img src="docs/img/built/shot-phantom.jpg" alt="Phantom: a signature with numbered pen strokes traced over a photo, with a list of pictures on the left and the strokes on the right." width="380"><br>
<b>Phantom</b><br>
A Swift Mac app that forensic<br>
experts use to analyze<br>
handwriting, built with 100x<br>
assistance
</td></tr></table>
<table align="left"><tr><td>
<img src="docs/img/built/shot-optionsflow.jpg" alt="OptionsFlow: an option chain table of calls and puts by strike next to a profit and loss chart." width="380"><br>
<b>OptionsFlow</b><br>
A real-time option chain tool in<br>
React used by quant firms, built<br>
with 100x assistance
</td></tr></table>
<br clear="all">

<table align="left"><tr><td>
<img src="docs/img/built/shot-skynet.jpg" alt="Skynet: a dark home screen with a list of apps along the top, one item that needs attention, a network graph, and tiles for incidents, machines, commitments and runs." width="380"><br>
<b>Skynet</b><br>
A project management tool built on<br>
Blueprint and Encore, with 100x<br>
assistance
</td></tr></table>
<table align="left"><tr><td>
<img src="docs/img/built/shot-boneworks.jpg" alt="Boneworks: six steps from a one-sentence brief to a picture, a 3D model, a skeleton with skin, animations and the character in a game." width="380"><br>
<b>Boneworks</b><br>
A text-to-3D pipeline that models,<br>
skins, rigs and animates characters,<br>
built with 100x assistance
</td></tr></table>
<br clear="all">

<p align="center">
  <a href="mailto:theory@deadinternet.com"><img src="docs/img/banners/built.png" width="760" alt="Projects: built something with 100x? Send it to theory@deadinternet.com"></a>
</p>

</div>

---

## What it costs

100x trades time and usage for proof.

- **A normal run takes hours.** Every polish pass and every review round is another model at work, so a run uses a good part of your plan.
- **For a first look**, `/100x-mockup` takes about 15 minutes. It skips the review and says so.
- **On a smaller plan**, `100x config preset lite --global` does one polish pass and two review rounds instead of three and five. The proof checks stay.
- **Not for small things.** For a one-line fix or a question, ask your agent directly. 100x is for a job that deserves a plan, a test and a review.

## Install

You need Claude Code, Cursor or Codex, and Node.js 22 or newer.

**1. Install the tool and the skills**

Choose one:

**npm**

```bash
npm install -g github:correriadev/100x-engineer-skill
100x install
```

**skills.sh**

```bash
npm install -g github:correriadev/100x-engineer-skill
npx skills add correriadev/100x-engineer-skill --skill '*' -g
100x install
```

The `skills` tool copies the skills only, so the `100x` tool still comes from npm. `100x install` then sees the copies and leaves them alone. Update them with `npx skills update -g`.

**2. Set up, in your agent**

```text
/100x-setup
```

It asks which plan you're on (Claude Pro, Max or Ultra, or OpenAI Go, Plus or Pro) and picks which model builds and which one judges. On a small plan, say so and it turns on the lite preset. More: [docs/plans-and-setup.md](docs/plans-and-setup.md).

**3. Give it a job**

```text
/100x Let me compare any stock with the S&P 500 in my stock market research app
```

Claude Code and Cursor start a skill with `/`. Codex uses `$`, as in `$100x-setup` and `$100x`. Use `/100x-overnight` when you're leaving for the night, or `/100x-mockup` for a first look.

### Other ways to install

**From a clone** (the way we test this repo)

```bash
./scripts/install.sh --dry-run   # preview
./scripts/install.sh
```

100x is two parts: skills your agent reads, and the `100x` command line tool. The tool does what a model can't do reliably on its own. It keeps the clock, takes screenshots, runs the judge, checks the proof and writes the report. Screenshots use Playwright. If it's missing, `100x browsers` installs it.

The installer only makes shortcuts (symbolic links), a few small files and their folders. It never overwrites a real file. `100x doctor` checks the result, and `./scripts/install.sh --uninstall` removes it. Every file it touches: [docs/cli.md](docs/cli.md).

## Modes

100x is a set of skills, called modes. Type a mode's name to use it. Words in your message never pick a mode, so `/100x an overnight oats app` builds an oats app.

| Type this | For | What it does |
|---|---|---|
| `/100x` | Build | The normal run: build, polish, test, second-model review. |
| `/100x-mockup` | Build | A fast first look in about 15 minutes. Only the key moment works. No review, and it says so (UNREVIEWED). |
| `/100x-overnight` | Build | For when you're leaving. Runs one idea or several, for a set time, and nudges the agent if it stalls. |
| `/100x-wrapup` | Build | For deadlines. Makes the main path work and hides the rest. |
| `/100x-solo` | Build | The whole run in one chat, with no subagents, no helpers and no second model. It judges its own work in writing, from another chair, and the report says nobody else looked. |
| `/100x-judge` | Review | Reviews something already built. Builds nothing new. |
| `/100x-grind` | Review | Review, fix, review again until a judge says ready to ship. Stops if three reviews in a row find nothing better, at 15 rounds, or when time runs out. |
| `/100x-status` | A run | Where the run is, in six lines or fewer. |
| `/100x-continue` | A run | Picks up a run that stopped, for example at a usage limit. |
| `/100x-report` | A run | Shows everything that finished, best first. Builds nothing. |
| `/100x-adhd` | Plan | A short back and forth, one question at a time, that turns a loose idea into a plan. Nothing builds until you say go. |
| `/100x-setup` | Setup | Asks one question about your plan, then sets which model does which job. |
| `/100x-bakeoff` | Test 100x | Tests 100x itself: the same agent builds the same ideas with and without it, and a blind judge compares them. Builds nothing. |

### Number phrases

Add these to your message to change a run. They work with `/100x` and `/100x-overnight`. Other words, like "fast" or "quick", do nothing.

| You write | What happens |
|---|---|
| `3 versions` | Builds 3 versions of the idea and finishes the best. Any number works. |
| `for 10 hours`, `for 2 days`, `until 6am` | Uses all that time. The run won't finish early. |
| `5 rounds of judging` | Runs that many review rounds. |
| `max 5 subagents` | At most 5 subagents at once. The default is 1. |

```text
/100x-overnight 3 versions of a farming game, for 8 hours, max 3 subagents
```

Each run starts by listing the phrases it understood, so you can spot a misread.

Give it a clock and it keeps working in rounds until the time is up. Each round looks at the project in a new way, keeps the change if it helped, and rolls it back if it didn't. A fresh second model checks every round.

<p align="center">
  <img src="docs/img/diagrams/overnight.svg" width="720" alt="You type: /100x-overnight a farming game, for 8 hours. After the first full run, 100x works in rounds until the clock ends: fresh eyes, break it, hard test, then more. Each round ends with a fresh second model checking it. Finish refuses until the clock is over, then the report.">
</p>

## FAQ

**Why a second model?** Different models have different blind spots. If none is available, the run still finishes and says UNREVIEWED. On a single plan, a smaller model from the same company can judge, with less benefit than another company's model.

**Will it put my project online?** No. It makes a preview only if the project already has one. Going live needs you to say so.

**What if I hit a usage limit mid-run?** 100x saves progress in `.100x/STATE.md`. When the limit resets, type `/100x-continue` in the same folder.

**Does it change my model or settings?** No. It never switches your model, effort level or sign-in. `/100x-setup` only writes 100x's own settings.

**Where do runs live?** In a hidden `.100x/` folder in each project (git ignores it), and a gallery of finished runs in `~/.100x`.

<p align="center">
  <a href="https://github.com/DeadInternetStudios/100x-engineer-skill/issues/new"><img src="docs/img/banners/issue.png" width="760" alt="Issues: did a run go wrong? Tell us what you typed and what happened."></a>
</p>

## Docs

| Page | What is in it |
|---|---|
| [Install, in full](docs/install.md) | every install option, and every file the installer touches |
| [Using 100x](docs/using.md) | a night away, the report page, the helper skill |
| [Formal verification](docs/verification.md) | the six properties, the ledger, what verified means, and how blocks add up to a system |
| [Pipeline and final message](docs/pipeline.md) | every step in full, and what `100x finish` checks |
| [Setup and plans](docs/plans-and-setup.md) | recommended Claude Code setup, the lite preset, setups for each plan |
| [Settings](docs/settings.md) | every config key |
| [CLI and file layout](docs/cli.md) | every `100x` command, and where files live |
| [Inside the skills, verifying](docs/contributing.md) | how the repo is laid out, and how to test it |
| [Design notes](docs/design.md) | why 100x works this way |

## Contributing

Bug reports, fixes and ideas are welcome. Small fixes can go straight to a pull request. For anything bigger, open an issue first so we can agree on it. [How to contribute](CONTRIBUTING.md).

<p align="center">
  <a href="CONTRIBUTING.md"><img src="docs/img/banners/contribute.png" width="760" alt="Contributing: help make 100x better. Fixes, checks, docs, translations."></a>
</p>

## Credits

100x builds on the working principles of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan (MIT), reworked for prototypes and for one conversation with your agent. What's different:

- Every run ends with a report page.
- `100x finish` refuses claims it cannot check.
- A second model reviews the work in rounds.

See [NOTICE.md](NOTICE.md) and [UPSTREAM.md](UPSTREAM.md).

MIT. See [LICENSE](LICENSE).

<p align="center">
  <a href="https://star-history.com/#DeadInternetStudios/100x-engineer-skill&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=deadinternetstudios/100x-engineer-skill&type=Date&theme=dark">
      <img src="https://api.star-history.com/svg?repos=deadinternetstudios/100x-engineer-skill&type=Date" width="600" alt="Star history">
    </picture>
  </a>
</p>
