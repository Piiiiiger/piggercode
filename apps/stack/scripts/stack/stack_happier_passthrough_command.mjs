import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { parseArgs } from '../utils/cli/args.mjs';
import { applyStackActiveServerScopeEnv } from '../utils/auth/stable_scope_id.mjs';
import { resolveStackEnvPath } from '../utils/paths/paths.mjs';
import { parseCliIdentityOrThrow, resolveCliHomeDirForIdentity } from '../utils/stack/cli_identities.mjs';

import { withStackEnv } from './stack_environment.mjs';

function stripIdentityWrapperArgs(args) {
  const stripped = [];

  for (let idx = 0; idx < args.length; idx += 1) {
    const arg = String(args[idx] ?? '');
    if (!arg) continue;
    if (arg === '--identity') {
      idx += 1;
      continue;
    }
    if (arg.startsWith('--identity=')) {
      continue;
    }
    stripped.push(arg);
  }

  return stripped;
}

export async function runStackHappierPassthroughCommand({ rootDir, stackName, passthrough }) {
  const sepIdx = passthrough.indexOf('--');
  const wrapperArgs = sepIdx === -1 ? passthrough : passthrough.slice(0, sepIdx);
  const forwardedArgsRaw = sepIdx === -1 ? passthrough : passthrough.slice(sepIdx + 1);

  const { kv } = parseArgs(wrapperArgs);
  const identityRaw = (kv.get('--identity') ?? '').toString().trim();
  const identity = identityRaw ? parseCliIdentityOrThrow(identityRaw) : null;

  const forwardedArgs =
    sepIdx === -1
      ? forwardedArgsRaw.filter((arg) => !(identity && typeof arg === 'string' && arg.trim().startsWith('--identity=')))
      : forwardedArgsRaw;
  const childArgs = sepIdx === -1 ? forwardedArgs : [...stripIdentityWrapperArgs(wrapperArgs), ...forwardedArgs];

  await withStackEnv({
    stackName,
    fn: async ({ env }) => {
      const baseCliHomeDir = (env.PIGGERCODE_STACK_CLI_HOME_DIR ?? join(resolveStackEnvPath(stackName).baseDir, 'cli')).toString();
      const cliHomeDirForIdentity = identity
        ? resolveCliHomeDirForIdentity({ cliHomeDir: baseCliHomeDir, identity })
        : baseCliHomeDir;

      let envForHappy = identity
        ? {
            ...env,
            PIGGERCODE_STACK_CLI_IDENTITY: identity,
            PIGGERCODE_HOME_DIR: cliHomeDirForIdentity,
            PIGGERCODE_STACK_CLI_HOME_DIR: cliHomeDirForIdentity,
          }
        : env;

      envForHappy = applyStackActiveServerScopeEnv({
        env: envForHappy,
        stackName,
        cliIdentity: identity || (envForHappy.PIGGERCODE_STACK_CLI_IDENTITY ?? '').toString().trim() || 'default',
      });

      const child = spawn(process.execPath, [join(rootDir, 'scripts', 'piggercode.mjs'), ...childArgs], {
        cwd: rootDir,
        env: envForHappy,
        stdio: 'inherit',
        shell: false,
      });

      const exitCode = await new Promise((resolvePromise) => {
        child.on('error', () => resolvePromise(1));
        child.on('exit', (code) => resolvePromise(code ?? 1));
      });

      process.exit(exitCode);
    },
  });
}
