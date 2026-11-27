import { TmuxUtilities } from '@/integrations/tmux';
import { createTmuxTerminalControlPort, type TmuxControlCommandExecutor } from '@/integrations/tmux/control';

export type OwnTerminalPane = Readonly<{
  /** The pane's current screen with its colours (SGR escapes) kept; null when tmux did not give it. */
  readScreen: () => Promise<string | null>;
  /** Types `text` and presses Enter; true when both reached the pane. */
  typeLine: (text: string) => Promise<boolean>;
}>;

/**
 * The tmux pane this runner runs in (the runner is the pane's process: `TMUX` names its server and `TMUX_PANE` the
 * pane), or null when the runner is not in tmux. Reading and typing go through tmux's terminal control port.
 */
export function createOwnTerminalPane(params: Readonly<{
  env?: NodeJS.ProcessEnv;
  /** The tmux command runner (replaced in tests). */
  executor?: TmuxControlCommandExecutor;
}> = {}): OwnTerminalPane | null {
  const env = params.env ?? process.env;
  const target = env.TMUX_PANE;
  if (!target || !env.TMUX) return null;
  const tmux = new TmuxUtilities();
  const port = createTmuxTerminalControlPort({
    target,
    executor: params.executor ?? ((args, options) => tmux.executeTmuxCommand(
      [...args], undefined, undefined, undefined, undefined, undefined, options,
    )),
  });
  return {
    readScreen: async () => {
      const result = await port.captureScreen();
      return result.status === 'captured' ? result.capture.styledText ?? result.capture.text : null;
    },
    typeLine: async (text) => {
      const typed = await port.sendLiteralText(text);
      if (typed.status !== 'sent') return false;
      return (await port.sendSpecialKey('Enter')).status === 'sent';
    },
  };
}
