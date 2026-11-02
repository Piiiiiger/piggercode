export function buildSetupChildEnv({ workspaceDirWanted = '', baseEnv = process.env } = {}) {
  const next = {
    ...baseEnv,
    PIGGERCODE_STACK_SETUP_CHILD: '1',
  };

  const workspaceDir = String(workspaceDirWanted ?? '').trim();
  if (workspaceDir) {
    next.PIGGERCODE_STACK_WORKSPACE_DIR = workspaceDir;
  }

  return next;
}
