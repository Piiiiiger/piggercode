import { resolveHappierRuntimeContextEnvFromConfiguration } from '@/utils/env/resolveHappierRuntimeContextEnvFromConfiguration';
import { configuration, type ShellBridgeContextEnvMode } from '@/configuration';

export const PIGGERCODE_SHELL_BRIDGE_CONTEXT_ENV_KEY = 'PIGGERCODE_SHELL_BRIDGE_CONTEXT_ENV';

export function resolveHappierToolsShellBridgeContextEnv(): Record<string, string> {
  const mode: ShellBridgeContextEnvMode = configuration.shellBridgeContextEnvMode;
  if (mode === 'off') return {};

  const contextEnv = resolveHappierRuntimeContextEnvFromConfiguration();
  if (mode === 'full') return contextEnv;

  const homeDir = contextEnv.PIGGERCODE_HOME_DIR;
  return typeof homeDir === 'string' && homeDir.trim().length > 0
    ? { PIGGERCODE_HOME_DIR: homeDir }
    : {};
}
