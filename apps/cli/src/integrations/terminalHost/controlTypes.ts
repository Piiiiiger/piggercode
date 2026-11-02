import { TERMINAL_SHIFT_TAB_SEQUENCE } from '@piggercode/agents';
import type { TerminalSpecialKey } from '@piggercode/agents';

export { TERMINAL_SHIFT_TAB_SEQUENCE, TERMINAL_SPECIAL_KEYS } from '@piggercode/agents';

export type {
  TerminalControlCapture,
  TerminalControlCaptureResult,
  TerminalControlPort,
  TerminalControlSendFailureReason,
  TerminalControlSendResult,
  TerminalControlUnsupportedReason,
  TerminalSpecialKey,
} from '@piggercode/agents';

/**
 * Raw byte sequence used for a {@link TerminalSpecialKey} when a host has no native named key
 * for it. zellij has no Tab/ShiftTab/CtrlC/Backspace action, so these are written as literal
 * bytes; tmux uses this only for ShiftTab (its named `S-Tab` is a proven no-op). `Enter` and
 * `Escape` are intentionally absent because both hosts have a dedicated named-key path.
 */
export const TERMINAL_SPECIAL_KEY_RAW_SEQUENCES: Readonly<
  Partial<Record<TerminalSpecialKey, string>>
> = Object.freeze({
  Tab: '\t',
  ShiftTab: TERMINAL_SHIFT_TAB_SEQUENCE,
  CtrlC: '\u0003',
  Backspace: '\u007f',
  ArrowUp: '\u001b[A',
  ArrowDown: '\u001b[B',
});
