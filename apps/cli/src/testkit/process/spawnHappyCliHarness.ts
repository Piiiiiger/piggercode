import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createEnvKeyScope } from '@/testkit/env/envScope'
import { withTempDir } from '@/testkit/fs/tempDir'

const SPAWN_HAPPY_CLI_ENV_KEYS = [
  'PIGGERCODE_CLI_SUBPROCESS_RUNTIME',
  'PIGGERCODE_CLI_SUBPROCESS_ENTRYPOINT',
  'PIGGERCODE_MANAGED_NODE_BIN',
  'PIGGERCODE_VARIANT',
  'PIGGERCODE_CLI_SUBPROCESS_ALLOW_TSX_FALLBACK',
  'PIGGERCODE_CLI_SUBPROCESS_PREFER_TSX',
  'PIGGERCODE_CLI_SUBPROCESS_DIST_ENTRYPOINT',
  'PIGGERCODE_CLI_SUBPROCESS_DAEMON_DIST_CLOSURE_FINGERPRINT',
  'PIGGERCODE_CLI_SUBPROCESS_RUNTIME_BACKED',
  'PIGGERCODE_CLI_SUBPROCESS_STACK_RUNTIME_STATE_PATH',
  'PIGGERCODE_WINDOWS_SESSION_RUNNER_BINARY',
  'PIGGERCODE_STACK_REPO_DIR',
  'PIGGERCODE_STACK_CLI_ROOT_DIR',
  'PIGGERCODE_STACK_STACK',
  'TSX_TSCONFIG_PATH',
] as const

export function createSpawnHappyCliEnvScope() {
  return createEnvKeyScope(SPAWN_HAPPY_CLI_ENV_KEYS)
}

export async function withTempHappyCliEntrypoint<T>(
  fn: (entrypoint: string) => Promise<T> | T,
  prefix = 'happier-cli-entrypoint-',
): Promise<T> {
  return await withTempDir(prefix, async (dir) => {
    const entrypoint = join(dir, 'index.mjs')
    writeFileSync(entrypoint, 'export {};\n', 'utf8')
    return await fn(entrypoint)
  })
}
