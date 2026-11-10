import { describe, expect, it } from 'vitest';

import { createTmuxSingleWindowAttachPlan } from './tmuxSingleWindowAttachPlan';

describe('createTmuxSingleWindowAttachPlan', () => {
  it('plans a temporary single-window tmux session for an attach target', () => {
    const plan = createTmuxSingleWindowAttachPlan({
      sessionId: 'cm-session_1',
      target: 'happy:happy-123-claude',
      processId: 1234,
      nowMs: 5678,
    });

    expect(plan).toEqual({
      tempSessionName: 'happy-attach-cm-session_1-1234-5678',
      createSessionArgs: [
        'new-session',
        '-d',
        '-s',
        'happy-attach-cm-session_1-1234-5678',
        '-n',
        '__happier_attach_placeholder__',
        'sleep 2147483647',
      ],
      hideStatusArgs: ['set-option', '-t', 'happy-attach-cm-session_1-1234-5678', 'status', 'off'],
      linkWindowArgs: [
        'link-window',
        '-s',
        'happy:happy-123-claude',
        '-t',
        'happy-attach-cm-session_1-1234-5678:',
      ],
      killPlaceholderWindowArgs: [
        'kill-window',
        '-t',
        'happy-attach-cm-session_1-1234-5678:__happier_attach_placeholder__',
      ],
      // Clipboard copies pass through to the app, and an empty scroll-back never holds the view.
      viewOptionsArgs: [
        'set-option', '-q', '-w', '-t', 'happy:happy-123-claude', 'allow-passthrough', 'on',
        ';', 'set-hook', '-w', '-t', 'happy:happy-123-claude', 'pane-mode-changed',
        "if-shell -F '#{&&:#{==:#{pane_mode},copy-mode},#{&&:#{==:#{history_size},0},#{?selection_present,0,1}}}' 'send-keys -X cancel'",
      ],
      // The temporary session goes as soon as its client does, even when the attach process is killed.
      attachSessionArgs: [
        'attach-session',
        '-t',
        'happy-attach-cm-session_1-1234-5678',
        ';',
        'set-option',
        '-t',
        'happy-attach-cm-session_1-1234-5678',
        'destroy-unattached',
        'on',
      ],
      cleanupSessionArgs: [
        'kill-session',
        '-t',
        'happy-attach-cm-session_1-1234-5678',
      ],
    });
  });

  it('sanitizes the session id for tmux session names', () => {
    const plan = createTmuxSingleWindowAttachPlan({
      sessionId: 'bad:session/name',
      target: 'happy:window',
      processId: 1,
      nowMs: 2,
    });

    expect(plan.tempSessionName).toBe('happy-attach-bad-session-name-1-2');
  });
});
