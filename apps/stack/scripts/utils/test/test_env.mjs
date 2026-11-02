import { join } from 'node:path';

export function readBooleanEnvFlag(env, name, fallback = false) {
  const raw = env && typeof env === 'object' ? env[name] : undefined;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  return fallback;
}

export function sanitizeDefinedEnv(env = {}) {
  const cleanEnv = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value == null) continue;
    cleanEnv[key] = String(value);
  }
  return cleanEnv;
}

const STACK_TEST_RUNNER_ENV_DENY_KEYS = new Set([
  'PIGGERCODE_ACTIVE_SERVER_ID',
  'PIGGERCODE_DAEMON_LIFECYCLE_SCOPE_ID',
  'PIGGERCODE_DAEMON_SERVICE_LABEL',
  'PIGGERCODE_DAEMON_STARTUP_SOURCE',
  'PIGGERCODE_CLI_SUBPROCESS_DAEMON_DIST_CLOSURE_FINGERPRINT',
  'PIGGERCODE_CLI_SUBPROCESS_DIST_ENTRYPOINT',
  'PIGGERCODE_CLI_SUBPROCESS_RUNTIME_BACKED',
  'PIGGERCODE_CLI_SUBPROCESS_STACK_RUNTIME_STATE_PATH',
  'PIGGERCODE_HOME_DIR',
  'PIGGERCODE_SERVER_URL',
  'PIGGERCODE_WEBAPP_URL',
]);
const STACK_TEST_ISOLATED_ROOT_MARKER = 'PIGGERCODE_STACK_TEST_ISOLATED_ROOT';
const STACK_TEST_REPO_DIR_MARKER = 'PIGGERCODE_STACK_TEST_REPO_DIR';

export function sanitizeStackTestRunnerEnv(env = {}, { isolatedStackRoot = '', repoDir = '' } = {}) {
  const cleanEnv = sanitizeDefinedEnv(env);
  const inheritedIsolatedStackRoot = String(cleanEnv[STACK_TEST_ISOLATED_ROOT_MARKER] ?? '').trim();
  const inheritedRepoDir = String(cleanEnv[STACK_TEST_REPO_DIR_MARKER] ?? '').trim();
  for (const key of Object.keys(cleanEnv)) {
    if (STACK_TEST_RUNNER_ENV_DENY_KEYS.has(key) || key.startsWith('PIGGERCODE_STACK_')) {
      delete cleanEnv[key];
    }
  }
  const root = String(isolatedStackRoot ?? '').trim() || inheritedIsolatedStackRoot;
  if (root) {
    cleanEnv[STACK_TEST_ISOLATED_ROOT_MARKER] = root;
    cleanEnv.PIGGERCODE_STACK_CANONICAL_HOME_DIR = join(root, 'canonical-home');
    cleanEnv.PIGGERCODE_STACK_HOME_DIR = join(root, 'home');
    cleanEnv.PIGGERCODE_STACK_STORAGE_DIR = join(root, 'stacks');
    cleanEnv.PIGGERCODE_STACK_WORKSPACE_DIR = join(root, 'workspace');
    cleanEnv.PIGGERCODE_STACK_RUNTIME_DIR = join(root, 'runtime');
  }
  const repo = String(repoDir ?? '').trim() || inheritedRepoDir;
  if (repo) {
    cleanEnv[STACK_TEST_REPO_DIR_MARKER] = repo;
    cleanEnv.PIGGERCODE_STACK_REPO_DIR = repo;
  }
  return cleanEnv;
}
