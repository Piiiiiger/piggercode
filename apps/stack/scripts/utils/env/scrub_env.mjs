export const SANDBOX_PRESERVE_KEYS = [
  'PIGGERCODE_STACK_VERBOSE',
  'PIGGERCODE_STACK_INVOKED_CWD',
  'PIGGERCODE_STACK_SANDBOX_DIR',
  'PIGGERCODE_STACK_SANDBOX_ALLOW_GLOBAL',
  'PIGGERCODE_STACK_SANDBOX_WORKSPACE_DIR',
  // Mobile review UX (safe to preserve; required so dev-client links target the correct app scheme).
  'PIGGERCODE_STACK_DEV_CLIENT_SCHEME',
  'PIGGERCODE_STACK_REVIEW_MOBILE_SCHEME',
  'PIGGERCODE_STACK_MOBILE_SCHEME',
  'PIGGERCODE_STACK_MOBILE_HOST',
  'PIGGERCODE_STACK_UPDATE_CHECK',
  'PIGGERCODE_STACK_UPDATE_CHECK_INTERVAL_MS',
  'PIGGERCODE_STACK_UPDATE_NOTIFY_INTERVAL_MS',
];

export const STACK_WRAPPER_PRESERVE_KEYS = [
  // Stack/env pointers:
  'PIGGERCODE_STACK_ENV_FILE',
  'PIGGERCODE_STACK_STACK',

  // Sandbox detection + policy.
  'PIGGERCODE_STACK_SANDBOX_DIR',
  'PIGGERCODE_STACK_SANDBOX_ALLOW_GLOBAL',
  'PIGGERCODE_STACK_SANDBOX_WORKSPACE_DIR',

  // Sandbox-enforced dirs.
  'PIGGERCODE_STACK_CLI_ROOT_DISABLE',
  'PIGGERCODE_STACK_CANONICAL_HOME_DIR',
  'PIGGERCODE_STACK_HOME_DIR',
  'PIGGERCODE_STACK_WORKSPACE_DIR',
  'PIGGERCODE_STACK_RUNTIME_DIR',
  'PIGGERCODE_STACK_STORAGE_DIR',

  // UX knobs.
  'PIGGERCODE_STACK_VERBOSE',
  // TUI marker (set by `hstack tui` and must survive stack env scrubbing).
  'PIGGERCODE_STACK_TUI',
  'PIGGERCODE_STACK_RESCUE',
  'PIGGERCODE_STACK_UPDATE_CHECK',
  'PIGGERCODE_STACK_UPDATE_CHECK_INTERVAL_MS',
  'PIGGERCODE_STACK_UPDATE_NOTIFY_INTERVAL_MS',

  // Guided auth flow coordination across wrappers.
  'PIGGERCODE_STACK_DAEMON_WAIT_FOR_AUTH',
  'PIGGERCODE_STACK_AUTH_FLOW',

  // Safe global defaults.
  'PIGGERCODE_STACK_STACK_PORT_START',
  'PIGGERCODE_STACK_LISTENER_OWNERSHIP_TIMEOUT_MS',

  // Explicit local runtime/build overrides for source-mode stack launches.
  'PIGGERCODE_STACK_CLI_BUILD',
  'PIGGERCODE_STACK_CLI_BUILD_MODE',
  'PIGGERCODE_STACK_SKIP_REFRESH_DEPS',
  'PIGGERCODE_STACK_DISABLE_REFRESH_DEPS',
  'PIGGERCODE_STACK_ALLOW_REFRESH_DEPS',
  'PIGGERCODE_STACK_SERVICE_ALLOW_REFRESH_DEPS',
  'PIGGERCODE_STACK_EXPO_EXPORT_MAX_WORKERS',

  'PIGGERCODE_STACK_BIND_MODE',
  'PIGGERCODE_STACK_EXPO_HOST',

  // Expo dev-server port strategy.
  'PIGGERCODE_STACK_EXPO_DEV_PORT',
  'PIGGERCODE_STACK_EXPO_DEV_PORT_STRATEGY',
  'PIGGERCODE_STACK_EXPO_DEV_PORT_BASE',
  'PIGGERCODE_STACK_EXPO_DEV_PORT_RANGE',

  // Mobile review UX.
  'PIGGERCODE_STACK_DEV_CLIENT_SCHEME',
  'PIGGERCODE_STACK_REVIEW_MOBILE_SCHEME',
  'PIGGERCODE_STACK_MOBILE_SCHEME',
  'PIGGERCODE_STACK_MOBILE_HOST',
];

export function scrubHappierStackEnv(
  env,
  { keepHappierStackKeys = [], clearUnprefixedKeys = [] } = {},
) {
  const input = env && typeof env === 'object' ? env : {};
  const out = { ...input };
  const keep = new Set((keepHappierStackKeys ?? []).map((k) => String(k).trim()).filter(Boolean));
  for (const k of Object.keys(out)) {
    if (k.startsWith('PIGGERCODE_STACK_') && !keep.has(k)) {
      delete out[k];
    }
  }
  for (const k of (clearUnprefixedKeys ?? []).map((x) => String(x).trim()).filter(Boolean)) {
    delete out[k];
  }
  return out;
}
