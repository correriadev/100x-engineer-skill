import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CliError } from '../errors.mjs';
import { pythonRuntime, workbenchAvailable, workbenchScript, WORKBENCH_PROGRAMS } from '../workbench.mjs';

const usage = `
100x workbench <mapper|scope|execute|qa> [arguments...]
100x workbench path <mapper|scope|execute|qa>

Runs the bundled Python program without changing its arguments, working directory,
standard streams or exit status. Python 3.12+, SQLite 3.37+ and Git are needed for
the engineering tools. Set X100_PYTHON to an executable path to choose Python.
`;

export default {
  name: 'workbench',
  summary: 'Run the bundled mapping and engineering contract tools.',
  usage,
  passThrough: true,
  async run([name, ...args]) {
    if (name === 'path') {
      const [tool] = args;
      if (args.length !== 1 || !workbenchAvailable(tool)) throw new CliError('Choose a bundled tool: mapper, scope, execute or qa.');
      const script = workbenchScript(tool);
      console.log(tool === 'mapper' ? path.dirname(path.dirname(script)) : path.dirname(script));
      return;
    }
    if (!Object.hasOwn(WORKBENCH_PROGRAMS, name ?? '')) throw new CliError('Choose a bundled tool: mapper, scope, execute or qa. Run `100x help workbench`.');
    if (!workbenchAvailable(name)) throw new CliError(`The bundled ${name} tool is missing. Reinstall or update the 100x package.`);
    const runtime = pythonRuntime();
    if (!runtime) throw new CliError('Python 3.12+ with SQLite 3.37+ is required. Install it, or set X100_PYTHON to its executable path.');
    const result = spawnSync(runtime.program, [...runtime.prefix, '-B', workbenchScript(name), ...args], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
    if (result.error) throw new CliError(`Could not run Python: ${result.error.message}`);
    process.exitCode = result.status ?? 1;
  },
};
