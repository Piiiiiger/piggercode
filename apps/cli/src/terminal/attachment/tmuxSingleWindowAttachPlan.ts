const PLACEHOLDER_WINDOW_NAME = '__happier_attach_placeholder__';
const PLACEHOLDER_COMMAND = 'sleep 2147483647';
/**
 * A pane in tmux's scroll-back (copy) mode with no history and no selection: there is nothing to scroll back to, the
 * view is frozen and typing is swallowed. One wheel turn or drag before the CLI takes the mouse (its first second, on
 * a blank screen) puts a pane there; a drag's own selection is left to finish its copy.
 */
const EMPTY_SCROLLBACK = '#{&&:#{==:#{pane_mode},copy-mode},#{&&:#{==:#{history_size},0},#{?selection_present,0,1}}}';

export type TmuxSingleWindowAttachPlan = Readonly<{
  tempSessionName: string;
  createSessionArgs: string[];
  /** The attached view is just the session's window (a 「终端」 session's Claude Code), with no tmux status line. */
  hideStatusArgs: string[];
  linkWindowArgs: string[];
  killPlaceholderWindowArgs: string[];
  /**
   * Window options for the agent's window, so every view of it has them: programs may pass escape sequences through
   * tmux (Claude Code and Codex send a copy to the clipboard of the computer the view is on that way), and the window
   * leaves scroll-back mode at once when it has nothing to scroll back to. Not needed to attach.
   */
  viewOptionsArgs: string[];
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
    viewOptionsArgs: [
      'set-option', '-q', '-w', '-t', params.target, 'allow-passthrough', 'on',
      ';', 'set-hook', '-w', '-t', params.target, 'pane-mode-changed', `if-shell -F '${EMPTY_SCROLLBACK}' 'send-keys -X cancel'`,
    ],
    attachSessionArgs: ['attach-session', '-t', tempSessionName, ';', 'set-option', '-t', tempSessionName, 'destroy-unattached', 'on'],
    cleanupSessionArgs: ['kill-session', '-t', tempSessionName],
  };
}
