import type { CommandSuiteEntry } from './runCommandSuite.ts';

/** Package-level checks that do not own a dedicated CI job. */
export const SHARED_PACKAGE_TEST_COMMANDS = [
  { id: 'privacy-kit:test', args: ['workspace', 'privacy-kit', 'test'] },
  { id: 'privacy-kit:bun', args: ['workspace', 'privacy-kit', 'test:runtime:bun'] },
  { id: 'protocol', args: ['workspace', '@piggercode/protocol', 'test'] },
  { id: 'transfers', args: ['workspace', '@piggercode/transfers', 'test'] },
  { id: 'sherpa-native', args: ['workspace', '@piggercode/sherpa-native', 'test'] },
  { id: 'agents', args: ['workspace', '@piggercode/agents', 'test'] },
  { id: 'cli-common', args: ['workspace', '@piggercode/cli-common', 'test'] },
  { id: 'release-runtime', args: ['workspace', '@piggercode/release-runtime', 'test'] },
  { id: 'connection-supervisor', args: ['workspace', '@piggercode/connection-supervisor', 'test'] },
  { id: 'bootstrap', args: ['workspace', '@piggercode/bootstrap', 'test'] },
  { id: 'relay-server', args: ['--cwd', 'packages/relay-server', 'test'] },
] as const satisfies readonly CommandSuiteEntry[];
