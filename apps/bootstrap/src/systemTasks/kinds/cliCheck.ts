import { systemTasks } from '@piggercode/cli-common';

import {
  checkLocalHappierCliForUpdate,
  resolveInstalledLocalHappierCli,
  resolveLocalHappierCliReleaseRing,
  withoutLocalHappierCliReleaseChannel,
} from '../happierCli.js';
import { parseBootstrapChannelParam } from './daemonService.js';

export type CliCheckTaskResult = Readonly<{
  /** The version of this computer's managed CLI that ran the check. */
  version: string;
}>;

function parseCliCheckParams(params: unknown) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new systemTasks.SystemTaskExecutionError('invalid_params', 'CLI check params must be an object.');
  }
  return { releaseRing: parseBootstrapChannelParam((params as Record<string, unknown>).channel) };
}

/**
 * `cli.check.v1` — the desktop's "is there a newer command line?" for this computer, without
 * downloading anything: this computer's managed CLI runs its own version check (`self check
 * --quiet`, the one writer of its update cache), and the app then re-reads this computer, whose
 * facts carry the latest version. The check is the installed CLI's, so it works whatever version
 * that CLI is. Only a CLI the app installed (managed) is checked — any other is not the app's to
 * update — and nothing is ever installed here.
 */
export function createCliCheckHandler() {
  return async function* (
    params: unknown,
    context: Readonly<{ signal: AbortSignal }>,
  ): AsyncGenerator<never, CliCheckTaskResult, void> {
    const { releaseRing: appRing } = parseCliCheckParams(params);
    // The ring of the CLI this computer actually runs (the app may have adopted another ring's
    // installed CLI), resolved as status reads resolve it — never from a channel this process
    // inherited: the same ring picks the CLI and names the releases its check looks at.
    const processEnv = withoutLocalHappierCliReleaseChannel(process.env);
    const releaseRing = resolveLocalHappierCliReleaseRing({ appRing, processEnv });
    const cli = await resolveInstalledLocalHappierCli({ releaseRing, processEnv, signal: context.signal });
    if (!cli || cli.provenance !== 'managed') {
      throw new systemTasks.SystemTaskExecutionError(
        'cli_not_managed',
        'There is no PiggerCode CLI installed by this app on this computer to check.',
      );
    }
    await checkLocalHappierCliForUpdate({ cli, releaseRing, processEnv, signal: context.signal });
    context.signal.throwIfAborted();
    return { version: cli.version };
  };
}
