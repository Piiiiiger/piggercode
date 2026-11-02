export function applyStackServerLoggingDefaults({ baseEnv = {}, serverEnv = {} } = {}) {
  const stackLevel = String(baseEnv.PIGGERCODE_STACK_SERVER_LOG_LEVEL ?? '').trim();
  if (stackLevel) {
    serverEnv.PIGGERCODE_SERVER_LOG_LEVEL = stackLevel;
    return serverEnv;
  }

  const explicitServerLevel = String(baseEnv.PIGGERCODE_SERVER_LOG_LEVEL ?? '').trim();
  if (explicitServerLevel) {
    serverEnv.PIGGERCODE_SERVER_LOG_LEVEL = explicitServerLevel;
    return serverEnv;
  }

  const inheritedLevel = String(baseEnv.PIGGERCODE_LOG_LEVEL ?? baseEnv.LOG_LEVEL ?? '').trim();
  if (!inheritedLevel && !String(serverEnv.PIGGERCODE_SERVER_LOG_LEVEL ?? '').trim()) {
    serverEnv.PIGGERCODE_SERVER_LOG_LEVEL = 'warn';
  }

  return serverEnv;
}
