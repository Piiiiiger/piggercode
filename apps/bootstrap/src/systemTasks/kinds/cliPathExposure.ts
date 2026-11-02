import { systemTasks } from '@piggercode/cli-common';
import {
  ensureHappierCliPathExposure,
  removeHappierCliPathExposure,
  resolveFirstPartyInstallLayout,
  type HappierCliPathExposureResult,
} from '@piggercode/cli-common/firstPartyRuntime';

import { parseDaemonServiceParams } from './daemonService.js';

type CliPathExposureDeps = Readonly<{
  processEnv: NodeJS.ProcessEnv;
}>;

function resolveManagedCliBinDir(processEnv: NodeJS.ProcessEnv): string {
  return resolveFirstPartyInstallLayout({ componentId: 'happier-cli', processEnv }).shimDir;
}

/**
 * Settings repair action: "Add piggercode to PATH". The setup executor calls the same owner after
 * readiness; this kind exists so the user can retry (or undo) it explicitly, and a failure here
 * is the user-facing result rather than a quiet one. `existingCommand` names another `piggercode`
 * that already resolves on PATH and was deliberately left in front (nothing is added then).
 */
export function createCliPathExposureEnsureHandler(overrides: Partial<CliPathExposureDeps> = {}) {
  const processEnv = overrides.processEnv ?? process.env;

  return async function* (
    params: unknown,
    _context: Readonly<{ signal: AbortSignal }>,
  ): AsyncGenerator<never, HappierCliPathExposureResult, void> {
    parseDaemonServiceParams(params);
    const result = await ensureHappierCliPathExposure({
      binDir: resolveManagedCliBinDir(processEnv),
      processEnv,
    });
    if (result.failure) {
      throw new systemTasks.SystemTaskExecutionError('cli_path_exposure_failed', result.failure);
    }
    return result;
  };
}

export function createCliPathExposureRemoveHandler(overrides: Partial<CliPathExposureDeps> = {}) {
  const processEnv = overrides.processEnv ?? process.env;

  return async function* (
    params: unknown,
    _context: Readonly<{ signal: AbortSignal }>,
  ): AsyncGenerator<never, Readonly<{ removed: boolean; failure: string | null }>, void> {
    parseDaemonServiceParams(params);
    const result = await removeHappierCliPathExposure({ processEnv });
    if (result.failure) {
      throw new systemTasks.SystemTaskExecutionError('cli_path_exposure_failed', result.failure);
    }
    return result;
  };
}
