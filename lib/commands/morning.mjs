import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildStamp } from '../build-stamp.mjs';
import { load } from '../config.mjs';
import { CliError } from '../errors.mjs';
import { COPY_ONLY, emptyLine, lede, renderGallery, windowWords } from '../gallery.mjs';
import { infoFile, readInfo, staleness, startServer, stopServer } from '../morning-server.mjs';
import { inProgress, inProgressLines } from '../in-progress.mjs';
import { decision, heldBack, trustLine } from '../look-first.mjs';
import { mustNotBreakLine } from '../must-not-break.mjs';
import { galleryFile, globalDir, REPO_ROOT } from '../paths.mjs';
import { openTarget } from '../proc.mjs';
import { countLeftOut, parseWindow, select } from '../registry.mjs';
import { refreshReports } from '../report-refresh.mjs';
import { modern } from '../runfile.mjs';
import { plural, sayWhat, verdictSay } from '../text.mjs';
import { reasonsFor, reasonText, SHORT, shownReasons } from '../why-not.mjs';

const usage = `
100x morning [--since 18h|2d] [--all] [--open] [--json]
100x morning --serve [--detach] [--port N] [--since 18h] [--all] [--open]
100x morning --stop

Collects every finished run from the registry, best verdict first, prints a ranking you can read out (four lines for each of the best five, one line for the rest), and writes
~/.100x/morning/index.html, where each button copies a run command. Default window is morning.windowHours from the config.
--serve starts a local server (127.0.0.1 only, random token in the URL) where Run and Stop start each prototype's
dev server for you. --detach keeps it running in the background. --stop ends it and the prototypes it started.
Under the ranking, "In progress" lists the runs that began (at their first 100x log) and have not finished: where each stands and the line that picks it up.
A run nobody touched inside the window is counted, and --all lists it. --json prints the finished runs only.
`;

const dir = () => path.join(globalDir(), 'morning');

const opener = openTarget;

// The best few get four lines each. Past that, one line each, so fifteen runs are not sixty lines. The gallery has the rest. The judge's
// reasons are what the owner asked for, so a run the judge refused gets one more line down there: its first reason and how many more its card has.
const DETAILED = 5;

function ranking(entries, label, all, building = 0) {
  entries = entries.map((entry) => modern(entry));
  if (!entries.length) return `Report. ${emptyLine(label, all, building)}`;
  const why = heldBack(entries);
  const lines = [`Report. ${lede(entries, label)}`, ...(why ? [why] : [])];
  entries.forEach((e, i) => {
    const m = e.matrix;
    const title = ['mockup', 'solo'].includes(e.mode) ? `${e.title} (${e.mode})` : e.title;
    const word = decision(e).padEnd(4);
    const rank = String(i + 1).padStart(2, '0');
    // The sentence that says what the run is comes first, even when the moment repeats it. A name alone tells the owner nothing.
    const what = sayWhat(e.pitch);
    if (i >= DETAILED) {
      if (i === DETAILED) lines.push('', 'The rest, one line each. The gallery has the detail.');
      // The moment is on the row only when it fits whole. A line that stops in the middle of a sentence says less than none.
      lines.push(`${rank} ${word} ${title}. ${what}${e.moment && e.moment.length <= 90 ? ` Moment: ${e.moment}` : ''}`);
      const { first, more } = shownReasons(reasonsFor(e), 1);
      if (first.length) lines.push(`   why    ${reasonText(first[0], SHORT)}${more ? `; and ${more} more on its card` : ''}`);
      return;
    }
    // Look first stands where the verdict would, so the verdict and the reason come next, and then the judge's reasons.
    const { first, more } = shownReasons(reasonsFor(e));
    const reasons = [...first.map((reason) => reasonText(reason, SHORT)), ...(more ? [`and ${more} more on its card`] : [])];
    lines.push(
      `${rank} ${word} ${title}. ${what}`,
      ...(decision(e) === 'look' ? [`   look   builder said ${verdictSay(e.verdict)}. ${trustLine(e).text}`] : []),
      ...reasons.map((reason, n) => `${n === 0 ? '   why    ' : '          '}${n < first.length ? `${n + 1}) ` : ''}${reason}`),
      ...(e.moment ? [`   moment ${e.moment}`] : []),
      ...(e.runCmd ? [`   run    cd ${e.path} && ${e.runCmd}${e.url ? `  (${e.url})` : ''}`] : []),
      `   checks ${e.mode === 'engineering' && e.acceptance ? `acceptance ${e.acceptance.status} at finish` : mustNotBreakLine(e)}. ${e.review.status === 'reviewed' ? `review ${e.review.model}${e.review.solo ? ' (solo, its own judge)' : ''} ${e.review.flags ?? 0} flagged ${e.review.fixed ?? 0} fixed` : e.mode === 'mockup' ? 'a mockup, no judge by design' : 'UNREVIEWED'}. ${m ? `screen sizes ${m.totals.broken} broken ${m.totals.weak} weak` : 'screen sizes not run'}`,
    );
  });
  return lines.join('\n');
}

export default {
  name: 'morning',
  summary: 'The report page with every finished run, the one the owner opens by saying report. It copies each run command, or starts the run with --serve.',
  usage,
  async run(argv) {
    const { values } = parseArgs({
      args: argv,
      options: { since: { type: 'string' }, all: { type: 'boolean' }, open: { type: 'boolean' }, json: { type: 'boolean' }, serve: { type: 'boolean' }, detach: { type: 'boolean' }, stop: { type: 'boolean' }, port: { type: 'string' } },
    });

    if (values.stop) {
      const info = readInfo();
      if (!info) {
        const stale = fs.existsSync(infoFile());
        fs.rmSync(infoFile(), { force: true });
        return console.log(stale ? 'no gallery server is running. Removed a stale server.json, and no process was signaled' : 'no gallery server is running');
      }
      await stopServer(info);
      return console.log(`stopped the gallery server (pid ${info.pid})`);
    }

    const hours = values.since ? parseWindow(values.since) : load().effective.morning.windowHours;
    if (!hours) throw new CliError('--since takes hours or days, for example 18h or 2d.');
    const label = windowWords(hours, values.all);

    if (values.serve) {
      const existing = readInfo();
      if (existing) {
        const old = await staleness(existing);
        if (!old) {
          console.log(`gallery server already running\n${existing.url}`);
          if (values.open) opener(existing.url);
          return undefined;
        }
        if (old.running) throw new CliError(`The gallery that is running was started by an older 100x, so it still shows the old page, and it has ${plural(old.running, 'prototype')} running that a restart would stop. To get the new page, run \`100x morning --stop\` and then \`100x morning --serve\` again. To go on with the old one: ${existing.url}`);
        await stopServer(existing);
        console.log('The gallery that was running was started by an older 100x, so it was restarted to show the new page.');
      }
      if (values.detach) {
        fs.mkdirSync(dir(), { recursive: true });
        const fd = fs.openSync(path.join(dir(), 'server.log'), 'a');
        const args = ['morning', '--serve', ...(values.since ? ['--since', values.since] : []), ...(values.all ? ['--all'] : []), ...(values.port ? ['--port', values.port] : [])];
        spawn(process.execPath, [path.join(REPO_ROOT, 'bin', '100x.mjs'), ...args], { detached: true, stdio: ['ignore', fd, fd], env: process.env, windowsHide: true }).unref();
        for (let i = 0; i < 40; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const started = readInfo();
          if (started) {
            console.log(`gallery server running\n${started.url}\nStop it with: 100x morning --stop`);
            if (values.open) opener(started.url);
            return undefined;
          }
        }
        throw new CliError(`The gallery server did not start. See ${path.join(dir(), 'server.log')}`);
      }
      const server = await startServer({ port: values.port ? Number(values.port) : 0, hours, all: values.all });
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(infoFile(), JSON.stringify({ pid: process.pid, port: server.port, url: server.url, build: buildStamp(), startedAt: new Date().toISOString() }));
      console.log(`gallery server running\n${server.url}`);
      if (values.open) opener(server.url);
      const shutdown = async () => {
        fs.rmSync(infoFile(), { force: true });
        await server.close();
        process.exit(0);
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
      return new Promise(() => {});
    }

    const entries = select({ sinceHours: hours, all: values.all });
    if (values.json) return console.log(JSON.stringify(entries, null, 2));
    refreshReports(entries);
    fs.mkdirSync(dir(), { recursive: true });
    const file = galleryFile();
    // A quiet window gets a second page with every run in it, so "show older runs" is a tap on the page and not a command to retype.
    let olderHref = null;
    const older = !entries.length && !values.all ? select({ all: true }) : [];
    // With nothing in the registry at all there is nothing older to point at, so the page says how a first run gets here.
    const nothingOlder = values.all || (!entries.length && !older.length);
    if (older.length) {
      refreshReports(older);
      olderHref = 'index-all.html';
      fs.writeFileSync(path.join(dir(), olderHref), renderGallery(older, { mode: 'static', windowLabel: 'so far', all: true, leftOut: countLeftOut({ all: true }), inProgress: inProgress({ all: true }) }));
    }
    const unfinished = inProgress({ sinceHours: hours, all: values.all });
    fs.writeFileSync(file, renderGallery(entries, { mode: 'static', windowLabel: label, all: nothingOlder, olderHref, leftOut: countLeftOut({ sinceHours: hours, all: values.all }), inProgress: unfinished }));
    console.log([ranking(entries, label, nothingOlder, unfinished.runs.length), ...inProgressLines(unfinished)].join('\n'));
    console.log(`\ngallery ${file}`);
    if (entries.some((entry) => entry.url)) console.log(COPY_ONLY.replace(/`/g, ''));
    if (values.open) opener(file);
    return undefined;
  },
};
