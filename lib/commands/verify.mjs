import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CliError } from '../errors.mjs';
import { findProjectRoot } from '../paths.mjs';
import { addRow, amendRow, covering, gaps, KINDS, LEVELS, PROCEDURE, readHistory, readLedger, retireRow, rowState, runRow, syncRow, waive, writeLedger } from '../verify.mjs';

const usage = `
100x verify status
100x verify cover <path>...
100x verify gaps [--base <ref>]
100x verify add <id> --kind <kind> --property "<sentence>" --covers <paths> --command "<cmd>" --level <level>
100x verify run [<id>]
100x verify sync <id> --note "<what you read>"
100x verify amend <id> --evidence "<why the promise changed>" [--property ...] [--covers ...] [--command ...] [--level ...]
100x verify retire <id> --why "<why it no longer applies>"
100x verify waive <path>... --why "<why no property can be written>"
100x verify history [<id>]

The ledger keeps what is verified, in the project and in git, so it travels with every branch.
  verify/ledger.tsv    one row per property: the code it covers, a hash of that code, the command, the level, the last result
  verify/history.tsv   every add, run, sync, amend, waive and retire, appended and never rewritten
  verify/red/<id>.txt  the failing run on a seeded defect, with a FAIL line. A property that never failed proves nothing
kinds: ${KINDS.join(", ")}.   levels: ${LEVELS.join(", ")}. A level says what the check really does, and run refuses exhaustive when the checker says BOUNDED.

holds      green, the covered code is the code that was last synced, and a failing run is on file
stale      the covered code changed after the last sync. Read the change, run, then sync
broken     the last run failed. Fix the code or, when the promise changed on purpose, amend with the evidence
unproven   green, but no failing run is on file
unchecked  never run

cover and gaps say which rule covers code. Code with no rule and no waiver starts the verification procedure (100x ref properties).
Options. --root <folder> to use another project. status and gaps exit 1 and cover exits 2 when something needs work.
`;

const rootOf = (values) => {
  if (values.root) return path.resolve(values.root);
  const found = findProjectRoot(process.cwd());
  if (found) return found;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.cwd();
  }
};
const need = (result) => { if (result.errors?.length) throw new CliError(result.errors.join('. ') + '.'); return result; };
const asRel = (root, file) => path.relative(root, path.resolve(process.cwd(), file)).split(path.sep).join('/');

export default {
  name: 'verify',
  summary: 'Keep the verified properties of the code in a ledger in the project, and say which rule covers a piece of code.',
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { root: { type: 'string' }, base: { type: 'string' }, kind: { type: 'string' }, property: { type: 'string' }, covers: { type: 'string' }, command: { type: 'string' }, level: { type: 'string' }, note: { type: 'string' }, evidence: { type: 'string' }, why: { type: 'string' } },
    });
    const [sub, ...rest] = positionals;
    const root = rootOf(values);
    const rows = readLedger(root);
    const find = (id) => { const row = rows.find((item) => item.id === id); if (!row) throw new CliError('no property called ' + id + '. 100x verify status lists them.'); return row; };

    if (sub === 'add') {
      if (!rest[0]) throw new CliError('Usage: 100x verify add <id> --kind <kind> --property "<sentence>" --covers <paths> --command "<cmd>" --level <level>');
      const { row } = need(addRow(root, { id: rest[0], kind: values.kind, property: values.property, covers: values.covers, command: values.command, level: values.level }));
      console.log('added ' + row.id + '. Next: save a failing run in verify/red/' + row.id + '.txt, then 100x verify run ' + row.id);
      return undefined;
    }
    if (sub === 'waive') {
      if (!rest.length) throw new CliError('Usage: 100x verify waive <path>... --why "<why no property can be written>"');
      const { added } = need(waive(root, rest.map((file) => asRel(root, file)), values.why));
      console.log(added.length ? 'waived ' + added.join(', ') : 'already waived');
      return undefined;
    }
    if (sub === 'run') {
      const list = rest[0] ? [find(rest[0])] : rows.filter((row) => row.kind !== 'waived');
      if (!list.length) throw new CliError('the ledger holds no property to run. Add one with 100x verify add.');
      let failed = 0;
      for (const row of list) {
        // The command comes from the ledger, a file in the project, like a script in package.json. Say what runs.
        console.log('$ ' + row.command);
        const result = runRow(root, row);
        console.log((result.ok ? 'pass' : 'FAIL') + '  ' + row.id + '. ' + row.kind + ', ' + row.level + ', ' + result.note);
        if (!result.ok) {
          failed += 1;
          console.log(result.output.trim().split('\n').slice(-15).map((line) => '    ' + line).join('\n'));
        }
      }
      writeLedger(root, rows);
      for (const row of list) {
        const { state, why } = rowState(root, row);
        if (state !== 'holds' && state !== 'broken') console.log('needs  ' + row.id + '. ' + state + '. ' + why);
      }
      process.exitCode = failed ? 1 : 0;
      return undefined;
    }
    if (sub === 'sync') {
      const row = find(rest[0]);
      need(syncRow(root, row, values.note));
      writeLedger(root, rows);
      console.log('synced ' + row.id + ' to the code as it is now');
      return undefined;
    }
    if (sub === 'amend') {
      const row = find(rest[0]);
      need(amendRow(root, row, { property: values.property, covers: values.covers, command: values.command, level: values.level }, values.evidence));
      writeLedger(root, rows);
      console.log('amended ' + row.id + ', and it is unchecked until it runs again. The old wording is in verify/history.tsv');
      return undefined;
    }
    if (sub === 'retire') {
      need(retireRow(root, rest[0], values.why));
      console.log('retired ' + rest[0] + '. verify/history.tsv keeps the row');
      return undefined;
    }
    if (sub === 'history') {
      const list = readHistory(root).filter((row) => !rest[0] || row.id === rest[0]);
      console.log(list.length ? list.map((row) => [row.ts, row.id, row.event, row.commit, row.result, row.note].join('  ')).join('\n') : '(no history yet)');
      return undefined;
    }
    if (sub === 'cover' || sub === 'gaps') {
      const files = sub === 'cover' ? rest.map((file) => asRel(root, file)) : gaps(root, values.base).files;
      if (sub === 'cover' && !files.length) throw new CliError('Usage: 100x verify cover <path>...');
      let uncovered = 0;
      for (const file of files) {
        const hit = covering(rows, file).filter((row) => row.kind !== 'waived' || rowState(root, row).state === 'waived');
        if (hit.length) console.log('covered  ' + file + '  by ' + hit.map((row) => row.id + (row.kind === 'waived' ? ' (waived)' : '')).join(', '));
        else { uncovered += 1; console.log('NO RULE  ' + file); }
      }
      if (sub === 'gaps' && !files.length) { const { base } = gaps(root, values.base); console.log(base ? 'No changed code since ' + base + '.' : 'No code files in the project.'); }
      if (uncovered) console.log('\n' + PROCEDURE);
      process.exitCode = uncovered ? (sub === 'cover' ? 2 : 1) : 0;
      return undefined;
    }
    if (sub === 'status' || sub === undefined) {
      if (!rows.length) { console.log('The ledger is empty. ' + PROCEDURE); process.exitCode = sub === 'status' ? 1 : 0; return undefined; }
      let needs = 0;
      for (const row of rows) {
        const { state, why } = rowState(root, row);
        if (state !== 'holds' && state !== 'waived') needs += 1;
        console.log(state.padEnd(9) + '  ' + row.id + '  ' + (row.kind === 'waived' ? 'waived' : row.kind + ', ' + row.level) + '  ' + (state === 'holds' || state === 'waived' ? row.property : why));
      }
      process.exitCode = needs ? 1 : 0;
      return undefined;
    }
    throw new CliError('unknown verify command "' + sub + '". Run `100x verify --help`.');
  },
};
