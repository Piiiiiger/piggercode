import { accessSync, constants } from 'node:fs';

import { resolveInstalledFirstPartyComponentPaths } from '@piggercode/cli-common/firstPartyRuntime';

import { readCliUpdateFactsForThisCli } from '@/cli/runtime/update/cliUpdateFacts';
import { configuration } from '@/configuration';
import { buildPosixShellCommand, buildPosixShellEnvironmentAssignments } from '@/utils/posixShellCommand';
import { buildHappyCliSubprocessLaunchSpec } from '@/utils/spawnHappyCLI';

/**
 * The forced command of a computer's key on this server: `piggercode machine shared-folders serve
 * --label <label>`. When this CLI runs from its managed install — as that install's binary or, under
 * the background service, as its package through the bundled JS runtime (the K5 decision,
 * `installSource: 'managed'`) — the command names that install's `current` binary, which an update
 * repoints and which always belongs to this ring's install, so the authorized_keys line keeps
 * working after this CLI's versioned path is replaced. Any other run (a source checkout), or an
 * install whose `current` binary is not there to run, uses the launch this CLI would use for itself.
 */
export function buildSharedFoldersServeCommand(
  label: string,
  deps: Readonly<{ runsManagedInstall?: () => boolean }> = {},
  /** The places in this server's home the computer may mount its folders at (`--place`, one each). */
  places: readonly string[] = [],
): string {
  return buildPiggercodeShellCommand(
    ['machine', 'shared-folders', 'serve', '--label', label, ...places.flatMap((place) => ['--place', place])],
    deps,
  );
}

/**
 * A shell command that runs this PiggerCode with `args` and keeps working across updates (as above):
 * the forced command of a computer's key, and the ProxyCommand of `ssh <computer>`.
 */
export function buildPiggercodeShellCommand(
  args: readonly string[],
  deps: Readonly<{ runsManagedInstall?: () => boolean }> = {},
): string {
  const runsManagedInstall = deps.runsManagedInstall ?? (() => readCliUpdateFactsForThisCli().installSource === 'managed');
  if (runsManagedInstall()) {
    const { binaryPath } = resolveInstalledFirstPartyComponentPaths({
      componentId: 'happier-cli',
      releaseRing: configuration.publicReleaseRing,
      processEnv: { ...process.env, PIGGERCODE_HOME_DIR: configuration.happyHomeDir },
    });
    if (isExecutable(binaryPath)) return buildPosixShellCommand([binaryPath, ...args]);
  }

  const launch = buildHappyCliSubprocessLaunchSpec([...args]);
  const command = buildPosixShellCommand([launch.filePath, ...launch.args]);
  const env = launch.env ?? {};
  return Object.keys(env).length === 0 ? command : `${buildPosixShellEnvironmentAssignments(env)} ${command}`;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
