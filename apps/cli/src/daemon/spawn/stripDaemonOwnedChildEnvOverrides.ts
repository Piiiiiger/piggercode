import { SESSION_MACHINE_WORKSPACE_PATH_ENV } from '@/agent/runtime/sessionWorkspaceLocation';

const DAEMON_OWNED_CHILD_ENV_KEYS = new Set<string>([
  'PIGGERCODE_HOME_DIR',
  'PIGGERCODE_ACTIVE_SERVER_ID',
  'PIGGERCODE_SERVER_URL',
  'PIGGERCODE_WEBAPP_URL',
  'PIGGERCODE_PUBLIC_SERVER_URL',
  'PIGGERCODE_LOCAL_SERVER_URL',
  'PIGGERCODE_DAEMON_SERVICE_INSTANCE_ID',
  'PIGGERCODE_DAEMON_SERVICE_SERVER_URL',
  SESSION_MACHINE_WORKSPACE_PATH_ENV,
]);

export function stripDaemonOwnedChildEnvOverrides(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    if (DAEMON_OWNED_CHILD_ENV_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
