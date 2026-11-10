const PLACEHOLDER_WINDOW_NAME = '__happier_attach_placeholder__';
const PLACEHOLDER_COMMAND = 'sleep 2147483647';

export type TmuxSingleWindowAttachPlan = Readonly<{
  tempSessionName: string;
  createSessionArgs: string[];
  /** The attached view is just the session's window (a 「终端」 session's Claude Code), with no tmux status line. */
  hideStatusArgs: string[];
  linkWindowArgs: string[];
  killPlaceholderWindowArgs: string[];
  /**
   * Attaches, and in the same tmux command marks the session to be destroyed once no client is attached: the
   * daemon ends an attach by closing its terminal, which kills this process before `cleanupSessionArgs` runs.
   */
  attachSessionArgs: string[];
  cleanupSessionArgs: string[];
}>;

function sanitizeTmuxSessionNamePart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'session';
}

export function createTmuxSingleWindowAttachPlan(params: Readonly<{
  sessionId: string;
  target: string;
  processId?: number;
  nowMs?: number;
}>): TmuxSingleWindowAttachPlan {
  const processId = params.processId ?? process.pid;
  const nowMs = params.nowMs ?? Date.now();
  const tempSessionName = `happy-attach-${sanitizeTmuxSessionNamePart(params.sessionId)}-${processId}-${nowMs}`;

  return {
    tempSessionName,
    createSessionArgs: [
      'new-session',
      '-d',
      '-s',
      tempSessionName,
      '-n',
      PLACEHOLDER_WINDOW_NAME,
      PLACEHOLDER_COMMAND,
    ],
    hideStatusArgs: ['set-option', '-t', tempSessionName, 'status', 'off'],
    linkWindowArgs: ['link-window', '-s', params.target, '-t', `${tempSessionName}:`],
    killPlaceholderWindowArgs: ['kill-window', '-t', `${tempSessionName}:${PLACEHOLDER_WINDOW_NAME}`],
    attachSessionArgs: ['attach-session', '-t', tempSessionName, ';', 'set-option', '-t', tempSessionName, 'destroy-unattached', 'on'],
    cleanupSessionArgs: ['kill-session', '-t', tempSessionName],
  };
}
