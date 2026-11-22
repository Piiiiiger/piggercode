import type { CliDetectSpec } from '@/backends/types';

/** `agy --version` prints the bare version (agy 1.5.14); agy has no login status command. */
export const cliDetect = {
  versionArgsToTry: [['--version']],
  loginStatusArgs: null,
} satisfies CliDetectSpec;
