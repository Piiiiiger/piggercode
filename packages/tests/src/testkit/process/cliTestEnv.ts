export function sanitizeCliTestEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  // Fixtures select their own relay, credential namespace, and working directory.
  // Ambient stack selection takes precedence unless it is removed.
  delete sanitized.PIGGERCODE_ACTIVE_SERVER_ID;
  delete sanitized.PIGGERCODE_STACK_INVOKED_CWD;
  delete sanitized.PIGGERCODE_DAEMON_PENDING_FIRST_INPUT;
  delete sanitized.PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID;
  delete sanitized.PIGGERCODE_DAEMON_SERVICE_SERVER_URL;
  return sanitized;
}
