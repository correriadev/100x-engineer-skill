# 100x Engineer

Give your coding agent one brief and get back a prototype worth keeping. 100x writes the prompt you would have written with an hour to spare. Then it builds the thing and polishes the look. It checks the one part that must not break, and a second model reviews it in rounds. You get a report with screenshots, test results and anything still open.

This plugin is the skills. They call the `100x` command line tool, which keeps the clock, takes the screenshots, runs the checks and writes the report. Install the tool as well. The integrated fork lives at [correriadev/100x-engineer-skill](https://github.com/correriadev/100x-engineer-skill), based on [DeadInternetStudios/100x-engineer-skill](https://github.com/DeadInternetStudios/100x-engineer-skill).

## Install

You need Claude Code, Node.js 22 or newer, and git. The skills also load in Claude's other apps. A run needs a shell with the tool installed, so Claude Code is where it is used and tested.

1. Add this plugin from the directory.
2. Install the tool, once:

   ```bash
   npm install -g github:correriadev/100x-engineer-skill
   100x install
   ```

3. In Claude Code, run `/100x-engineer:100x-setup`. It asks which plan you are on and picks which model builds and which one judges.
4. Give it a job:

   ```text
   /100x-engineer:100x Let me compare any stock with the S&P 500 in my stock market research app
   ```

`100x install` sets up `~/.100x`, puts a link to `100x` in `~/.local/bin`, and links the skills into `~/.agents/skills` for agents that read that folder. It writes nothing into `~/.claude`, so the plugin's skills are the only copies Claude Code sees. `100x doctor` checks the result. Mapping and engineering contracts need Python 3.12+, SQLite 3.37+ and Git. The `100x workbench` adapter runs the intact Python modules shipped with the CLI; the plugin never asks the agent to rebuild them from Markdown.

## Modes

Each mode is a skill of its own. A word inside your brief never picks a mode, so `/100x-engineer:100x an overnight oats app` builds an oats app.

| Skill | What it does |
|---|---|
| `100x` | The normal run: plan, build, polish, test the one thing that must not break, review. |
| `100x-mockup` | A first look in about 15 minutes. No review, and it says so. |
| `100x-overnight` | For when you are leaving. Runs one brief or several for a set time. |
| `100x-wrapup` | For a deadline. Makes the main path work and hides the rest. |
| `100x-solo` | The whole run in one chat, with no helpers and no second model. |
| `100x-judge`, `100x-grind` | Rounds of review on what exists. Grind keeps fixing until a judge says ready. |
| `100x-continue`, `100x-status`, `100x-report` | Pick up an unfinished run, say where it stands, or list what finished. |
| `100x-setup`, `100x-adhd`, `100x-bakeoff` | Choose models, talk an idea into a brief, or test the skill against no skill. |

## What it runs, sends and fetches

The plugin has no hooks, no commands, no agents and no MCP servers. It sends nothing itself. It is Markdown guides plus six small test templates in `skills/100x/assets/`. The directory takes no script files, so each template is a Markdown file that holds its code. Claude saves the code as a script in your project and runs it there.

What the skills tell Claude to do, all on your computer:

- Run `100x` commands, your project's own build and tests, and a local dev server.
- Take screenshots of the pages it builds with Playwright, with the browser muted.
- Write a `.100x/` folder in your project, kept out of git. Write a `verify/` folder with the ledger of checked properties, which git tracks. Commit in your repo. It never pushes to a remote or opens a pull request unless you authorize that action.
- Start helpers for the review and for overnight children, with Claude's own subagent tool. A helper reads and writes your project with your permissions.

Only these reach the network, and only when you ask for them:

- Your model host sees the brief and the files Claude reads, as in any Claude session.
- `100x browsers` downloads Playwright and Chromium into `~/.100x`, from npm and Playwright's download servers.
- The live-data template `fresh-data-check.mjs` makes one GET request to the URL you give it, to read a timestamp. It sends no headers or body of yours, reads no credentials and runs only against the source your brief names.
- A run deploys a **preview** when your project already has a deploy setup (Vercel, Netlify, Cloudflare Pages, Firebase or Fly). It uses the login that is already on your machine and never the production flag, unless your brief says "deploy to production" in words. It does not create accounts or paste tokens.
- On Cursor only, `100x helper setup`, `login` and `run` install `@cursor/sdk` from npm and start helpers on your own Cursor account. You sign in once in the browser, or set `CURSOR_API_KEY` yourself. 100x never prints the key. The helper's task and what it reads go to Cursor. Claude Code users never need these.

One setting is off until you turn it on. `review.command` lets you start the judge as a shell command, set only in your global config, and only when you ask for it. The example for Claude in `skills/100x/references/apps.md` runs `claude -p` with `--permission-mode bypassPermissions`, so the judge can work unattended. The plugin never writes that setting itself, and it never changes Claude's permission settings.

The `100x` tool has no analytics and no server of its own.

## Data

- `~/.100x/` holds your settings (`config.json`), a profile file you can edit (`profile.md`) and a list of finished runs. `<project>/.100x/` holds the brief, decisions, screenshots and report of one project. Both stay on your computer until you delete them.
- `100x install --uninstall` removes what the installer made.

## More

- Docs and source: [github.com/correriadev/100x-engineer-skill](https://github.com/correriadev/100x-engineer-skill)
- Bugs and questions: [open an issue](https://github.com/correriadev/100x-engineer-skill/issues/new)
- License: MIT. Parts adapt [pstack](https://github.com/cursor/plugins/tree/main/pstack), also MIT. See `NOTICE.md`.
