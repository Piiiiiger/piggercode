import { TmuxUtilities } from '@/integrations/tmux';

/**
 * When someone last typed into this terminal from a view attached to it (the app's terminal view is
 * a tmux client, and tmux keeps each client's last input), in ms; 0 when no view shows it, null when
 * this cannot be told (the runner is not the process of a tmux pane, or tmux did not answer).
 *
 * The runner is that pane's process, so `TMUX` names its server and `TMUX_PANE` its pane; a
 * 「终端」 window has that one pane, so a client showing the window shows the pane.
 */
export async function readTerminalLastInputAt(env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
  const pane = env.TMUX_PANE;
  if (!pane || !env.TMUX) return null;
  const result = await new TmuxUtilities().executeTmuxCommand(['list-clients', '-F', '#{pane_id} #{client_activity}']);
  if (result?.returncode !== 0) return null;
  let lastInputAt = 0;
  for (const line of result.stdout.split('\n')) {
    const [paneId, activity] = line.trim().split(' ');
    const seconds = Number(activity);
    if (paneId === pane && Number.isFinite(seconds) && seconds > 0) {
      lastInputAt = Math.max(lastInputAt, seconds * 1000);
    }
  }
  return lastInputAt;
}
