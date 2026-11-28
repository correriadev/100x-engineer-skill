import { parseArgs } from 'node:util';
import { formatCheck, repoSkills, runDoctor } from '../doctor.mjs';
import { APP_NAMES, appsHere, install, uninstall } from '../install.mjs';
import { LINK_NOTES } from '../links.mjs';

const usage = `
100x install [--uninstall] [--force] [--dry-run] [--no-unslop] [--no-bin] [--json] [--also claude,codex,opencode,cursor]
             [--unslop-text <dir>] [--bin-dir <dir>] [--home <dir>] [--skills-dir <dir>]

Links every skill of this repository into the agent skills folder (~/.agents/skills), links the pinned copy of
unslop-text that ships in vendor/, creates ~/.100x (CLI link, config.json, profile.md) and puts \`100x\` on
PATH through ~/.local/bin. Everything is a symlink or a small file, so a git pull here updates the install.
Safe to run again. Nothing outside these paths is touched, and a real folder or file is never replaced. A link you made
to your own copy of unslop-text is kept, unless you pass --force.
--unslop-text <dir> links that checkout's skills folder instead of the pinned copy.

--uninstall  remove only what this command made, read from ~/.100x/install.json. Files you edited stay.
--no-unslop  do not link unslop-text
--no-bin     do not put \`100x\` on PATH
--json       print the result as JSON
--also       link the skills into the folders of other agent apps as well, for apps that do not read ~/.agents/skills
--force      replace a symlink that points somewhere else, and restore it on uninstall
--dry-run    print the plan and change nothing
`;

function print(result, json) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  for (const e of result.events) console.log(`${e.kind.padEnd(5)}  ${e.status.padEnd(13)}  ${e.path}${e.detail ? `  ${e.detail}` : ''}`);
  for (const how of new Set(result.events.map((e) => e.how).filter(Boolean))) console.log(`\n${LINK_NOTES[how]}`);
  return undefined;
}

const names = (apps) => apps.map((app) => APP_NAMES[app]).join(' and ');
const UNINSTALLED = 'Uninstalled. Your data in the 100x home folder (runs, gallery, edited files) stays.';

// The lines a real install ends with. A dry run prints them too, marked as a preview, so what a stranger is told to trust shows the ending.
// How to call the skill is named only for the apps that are here or that this install just linked, so nobody is told to type what cannot work for them.
function installed(options) {
  const slash = options.also.filter((app) => ['claude', 'cursor'].includes(app));
  const ways = slash.length ? [`\`/100x\` in ${names(slash)}`] : [];
  const lines = [`Installed. Call the 100x skill with a brief in a new thread${ways.length ? `. ${ways.join(', ')}` : ' of your agent app'}.`];
  const modes = repoSkills().filter((name) => name.startsWith('100x-'));
  if (modes.length) lines.push(`The other modes are skills of their own, called the same way: ${modes.map((name) => `\`${name}\``).join(', ')}.`);
  const unlinked = appsHere().filter((app) => !options.also.includes(app));
  if (!unlinked.length && !ways.length) lines.push(`No agent app was found here. If yours does not read ~/.agents/skills, run \`100x install --also ${Object.keys(APP_NAMES).join(',')}\` to link the skills into its folder.`);
  if (unlinked.length) lines.push(`${names(unlinked)} ${unlinked.length === 1 ? 'is' : 'are'} on this machine and ${unlinked.length === 1 ? 'reads its' : 'read their'} own skills folder, not ~/.agents/skills. Run \`100x install --also ${unlinked.join(',')}\` to link the skills there too.`);
  return lines;
}

export default {
  name: 'install',
  summary: 'Link the skills, bootstrap ~/.100x and put 100x on PATH (or undo it).',
  usage,
  async run(argv) {
    const { values } = parseArgs({
      args: argv,
      options: {
        uninstall: { type: 'boolean' },
        force: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'no-unslop': { type: 'boolean' },
        'no-bin': { type: 'boolean' },
        json: { type: 'boolean' },
        'unslop-text': { type: 'string' },
        'bin-dir': { type: 'string' },
        home: { type: 'string' },
        'skills-dir': { type: 'string' },
        also: { type: 'string' },
      },
    });
    const options = {
      force: values.force,
      dryRun: values['dry-run'],
      unslop: values['no-unslop'] ? false : undefined,
      unslopText: values['unslop-text'] ?? process.env.X100_UNSLOP_TEXT_REPO,
      binDir: values['no-bin'] ? false : values['bin-dir'],
      home: values.home,
      skills: values['skills-dir'],
      also: values.also ? values.also.split(',').map((app) => app.trim()).filter(Boolean) : [],
    };
    const result = values.uninstall ? uninstall(options) : install(options);
    print(result, values.json);
    if (!values.json) {
      if (result.dryRun) {
        const ending = values.uninstall ? [UNINSTALLED] : installed(options);
        console.log(`\nDry run. Nothing changed.\nA real ${values.uninstall ? 'uninstall' : 'install'} ends with ${values.uninstall ? 'this line' : 'a check of the result (it runs after the changes, so not now) and these lines'}:\n${ending.map((line) => `  ${line}`).join('\n')}`);
      } else if (values.uninstall) {
        console.log(`\n${UNINSTALLED}`);
      } else {
        process.env.X100_HOME = result.home;
        process.env.X100_SKILLS_DIR = result.skills;
        const checks = await runDoctor();
        console.log('\nDoctor');
        for (const c of checks) if (c.status !== 'ok') console.log(formatCheck(c));
        console.log(`${checks.filter((c) => c.status === 'ok').length} of ${checks.length} checks ok`);
        if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
        console.log(result.ok ? `\n${installed(options).join('\n')}` : '\nInstallation incomplete. Resolve the conflicts or outdated copies listed above; existing files were preserved.');
      }
    }
    if (!result.ok) process.exitCode = 1;
    return undefined;
  },
};
