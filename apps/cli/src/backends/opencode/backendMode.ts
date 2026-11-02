export function resolveOpenCodeBackendModeFromEnv(env: NodeJS.ProcessEnv): 'server' | 'acp' {
  const raw = env.PIGGERCODE_OPENCODE_BACKEND_MODE?.trim().toLowerCase();
  return raw === 'acp' ? 'acp' : 'server';
}
